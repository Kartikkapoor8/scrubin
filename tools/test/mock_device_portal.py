#!/usr/bin/env python3
"""Fake HoloLens Device Portal for testing tools/*.ps1 without a headset.

    python tools/test/mock_device_portal.py [port]        (default 18443, plain HTTP, localhost only)

Then, in another shell (fake credentials, nothing real):
    $env:HOLOLENS_IP='127.0.0.1:18443'; $env:HOLOLENS_SCHEME='http'
    $env:HOLOLENS_USER='mockuser'; $env:HOLOLENS_PASS='mockpass'
    tools\\deploy.ps1 ; tools\\record.ps1 start ; tools\\record.ps1 stop ; tools\\stream-check.ps1

Mimics the Microsoft Device Portal API reference behaviour the scripts rely on: Basic auth with a 401
challenge, a CSRF-Token cookie that POST/DELETE must echo as X-CSRF-Token, multipart package install with
204-then-200 state polling, in-place update only to a higher version, hex64 (base64) app ids, MRC recording,
and a chunked live MP4 stream. Every request is logged to stdout.
"""
import base64
import json
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

USER, PASS, CSRF = "mockuser", "mockpass", "mock-csrf-token-123"
HASH = "8wekyb3d8bbwe"
STATE = {"installed": None, "install_polls": 0, "install_result": None, "running": False,
         "recording": False, "recordings": []}
LOCK = threading.Lock()


def ver_tuple(v):
    return tuple(int(x) for x in v.split("."))


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stdout.write("[mock] %s %s\n" % (self.command, self.path.split("?")[0]))
        sys.stdout.flush()

    # ---- helpers
    def send(self, code, body=b"", ctype="application/json", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Set-Cookie", "CSRF-Token=%s; Path=/" % CSRF)
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def authed(self):
        h = self.headers.get("Authorization", "")
        ok = h == "Basic " + base64.b64encode(("%s:%s" % (USER, PASS)).encode()).decode()
        if not ok:
            self.drain()
            self.send(401, "", "text/plain", {"WWW-Authenticate": 'Basic realm="Windows Device Portal"'})
        return ok

    def csrf_ok(self):
        if self.headers.get("X-CSRF-Token") != CSRF:
            self.drain()
            self.send(403, {"Reason": "missing/invalid X-CSRF-Token"})
            return False
        return True

    def drain(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n:
            self.rfile.read(n)

    def q(self):
        return {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}

    def path_only(self):
        return urlparse(self.path).path

    # ---- verbs
    def do_GET(self):
        if not self.authed():
            return
        p, q = self.path_only(), self.q()
        with LOCK:
            if p == "/":
                return self.send(200, "<html>Mock Device Portal</html>", "text/html")
            if p == "/api/os/info":
                return self.send(200, {"ComputerName": "MOCK-HOLOLENS", "OsVersion": "10.0.17763.mock"})
            if p == "/api/power/battery":
                return self.send(200, {"RemainingCapacity": 61, "MaximumCapacity": 100, "Charging": 1})
            if p == "/api/app/packagemanager/packages":
                pk = [STATE["installed"]] if STATE["installed"] else []
                return self.send(200, {"InstalledPackages": pk})
            if p == "/api/app/packagemanager/state":
                if STATE["install_result"] is None:
                    return self.send(404, {"Reason": "no install in progress"})
                STATE["install_polls"] += 1
                if STATE["install_polls"] < 3:
                    return self.send(204)
                res = STATE["install_result"]
                return self.send(200, res)
            if p == "/api/holographic/mrc/status":
                return self.send(200, {"IsRecording": STATE["recording"]})
            if p == "/api/holographic/mrc/files":
                return self.send(200, {"MrcRecordings": STATE["recordings"]})
            if p == "/api/holographic/mrc/file":
                name = base64.b64decode(q.get("filename", "")).decode()
                rec = [r for r in STATE["recordings"] if r["FileName"] == name]
                if not rec:
                    return self.send(404, {"Reason": "no such file " + name})
                data = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * (rec[0]["FileSize"] - 12)
                return self.send(200, data, "video/mp4")
        if p.startswith("/api/holographic/stream/live") and p.endswith(".mp4"):
            return self.stream()
        self.send(404, {"Reason": "mock: unknown GET " + p})

    def stream(self):
        # Chunked fragmented-MP4-looking bytes at ~5 Mbit/s for up to 30 s.
        self.send_response(200)
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()
        chunk = b"\x00\x00\x00\x18ftypiso5" + b"\x00" * 65524
        t0 = time.time()
        try:
            while time.time() - t0 < 30:
                self.wfile.write(b"%x\r\n" % len(chunk) + chunk + b"\r\n")
                self.wfile.flush()
                time.sleep(0.1)
                chunk = b"\x00\x00\x00\x08moof" + b"\x00" * 65528
            self.wfile.write(b"0\r\n\r\n")
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def do_DELETE(self):
        if not self.authed() or not self.csrf_ok():
            return
        p, q = self.path_only(), self.q()
        with LOCK:
            if p == "/api/app/packagemanager/package":
                inst = STATE["installed"]
                if not inst or q.get("package") != inst["PackageFullName"]:
                    return self.send(404, {"Reason": "not installed: %s" % q.get("package")})
                STATE["installed"] = None
                return self.send(200, {})
            if p == "/api/taskmanager/app":
                STATE["running"] = False
                return self.send(200, {})
            if p == "/api/holographic/mrc/file":
                name = base64.b64decode(q.get("filename", "")).decode()
                STATE["recordings"] = [r for r in STATE["recordings"] if r["FileName"] != name]
                return self.send(200, {})
        self.send(404, {"Reason": "mock: unknown DELETE " + p})

    def do_POST(self):
        if not self.authed() or not self.csrf_ok():
            return
        p, q = self.path_only(), self.q()
        if p == "/api/app/packagemanager/package":
            return self.install(q)
        self.drain()
        with LOCK:
            if p == "/api/taskmanager/app":
                appid = base64.b64decode(q.get("appid", "")).decode()
                pkg = base64.b64decode(q.get("package", "")).decode()
                inst = STATE["installed"]
                if not inst or pkg != inst["PackageFullName"] or appid != inst["PackageRelativeId"]:
                    return self.send(400, {"Reason": "bad appid/package: %s / %s" % (appid, pkg)})
                STATE["running"] = True
                print("[mock] launched %s" % appid)
                return self.send(200, {})
            if p == "/api/holographic/mrc/video/control/start":
                if q.get("holo") != "true" or q.get("pv") != "true":
                    return self.send(400, {"Reason": "expected holo=true&pv=true, got %r" % q})
                STATE["recording"] = True
                return self.send(200, {})
            if p == "/api/holographic/mrc/video/control/stop":
                if STATE["recording"]:
                    n = len(STATE["recordings"]) + 1
                    STATE["recordings"].append({"FileName": "20261114_mock_%03d_HoloLens.mp4" % n,
                                                "FileSize": 300000 + n, "CreationTime": 133000000000000000 + n})
                STATE["recording"] = False
                return self.send(200, {})
        self.send(404, {"Reason": "mock: unknown POST " + p})

    def install(self, q):
        n = int(self.headers.get("Content-Length") or 0)
        ctype = self.headers.get("Content-Type", "")
        body = self.rfile.read(n) if n else b""
        if "chunked" in (self.headers.get("Transfer-Encoding") or ""):
            body = self.read_chunked()
        m = re.search(r"boundary=\"?([^\";]+)", ctype)
        if not m:
            return self.send(400, {"Reason": "not multipart: " + ctype})
        # Be as strict as the real Device Portal might be: plain boundary, plain quoted filenames.
        if 'boundary="' in ctype:
            return self.send(400, {"Reason": "strict mock: quoted multipart boundary"})
        if b"filename*=" in body:
            return self.send(400, {"Reason": "strict mock: RFC 5987 filename*= parameter"})
        parts = body.count(b"--" + m.group(1).encode()) - 1
        fname = q.get("package", "")
        mv = re.match(r"(?P<name>[^_]+)_(?P<ver>\d+\.\d+\.\d+\.\d+)_", fname)
        if not mv or fname.encode() not in body:
            return self.send(400, {"Reason": "package query %r not found in multipart body" % fname})
        name, ver = mv.group("name"), mv.group("ver")
        print("[mock] install %s v%s: %d multipart part(s), %.1f MB" % (name, ver, parts, len(body) / 1e6))
        with LOCK:
            inst = STATE["installed"]
            STATE["install_polls"] = 0
            if inst and ver_tuple(ver) <= ver_tuple(inst["Version"]):
                STATE["install_result"] = {"Success": False, "Code": -2147009284, "CodeText": "0x80073CFB",
                                           "Reason": "The provided package is already installed (same or lower version)."}
            else:
                full = "%s_%s_x86__%s" % (name, ver, HASH)
                STATE["installed"] = {"Name": name, "Version": ver, "PackageFamilyName": "%s_%s" % (name, HASH),
                                      "PackageFullName": full, "PackageRelativeId": "%s_%s!App" % (name, HASH)}
                STATE["install_result"] = {"Success": True, "Code": 0, "CodeText": "", "Reason": ""}
        self.send(202, {})

    def read_chunked(self):
        data = b""
        while True:
            size = int(self.rfile.readline().strip(), 16)
            if size == 0:
                self.rfile.readline()
                return data
            data += self.rfile.read(size)
            self.rfile.readline()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 18443
    print("[mock] Device Portal mock on http://127.0.0.1:%d (user %s)" % (port, USER))
    sys.stdout.flush()
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
