#!/usr/bin/env python3
"""Create Unity .meta files for assets that were added outside the Unity editor.

Unity identifies every asset by the GUID in its .meta file. If two machines each let Unity invent a
GUID for the same file, the repo gets conflicting .meta files and references break. An agent working on
a machine without Unity runs this instead, so the GUIDs are stable (derived from the asset path) and
committed together with the asset.

    python3 tools/gen_meta.py           # create missing .meta files under Assets/
    python3 tools/gen_meta.py --check   # list what is missing, change nothing

Existing .meta files are never modified.
"""
import hashlib
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(REPO, "Assets")

FOLDER = """fileFormatVersion: 2
guid: {guid}
folderAsset: yes
DefaultImporter:
  externalObjects: {{}}
  userData:
  assetBundleName:
  assetBundleVariant:
"""

MONO = """fileFormatVersion: 2
guid: {guid}
MonoImporter:
  externalObjects: {{}}
  serializedVersion: 2
  defaultReferences: []
  executionOrder: 0
  icon: {{instanceID: 0}}
  userData:
  assetBundleName:
  assetBundleVariant:
"""

SHADER = """fileFormatVersion: 2
guid: {guid}
ShaderImporter:
  externalObjects: {{}}
  defaultTextures: []
  nonModifiableTextures: []
  userData:
  assetBundleName:
  assetBundleVariant:
"""

TEXT = """fileFormatVersion: 2
guid: {guid}
TextScriptImporter:
  externalObjects: {{}}
  userData:
  assetBundleName:
  assetBundleVariant:
"""

DEFAULT = """fileFormatVersion: 2
guid: {guid}
DefaultImporter:
  externalObjects: {{}}
  userData:
  assetBundleName:
  assetBundleVariant:
"""

BY_EXT = {
    ".cs": MONO,
    ".shader": SHADER,
    ".cginc": SHADER,
    ".json": TEXT,
    ".txt": TEXT,
    ".md": TEXT,
    ".xml": TEXT,
}


def guid_for(rel_path):
    return hashlib.md5(("scrubin:" + rel_path.replace(os.sep, "/")).encode("utf-8")).hexdigest()


def wanted(name):
    # Unity ignores hidden files and anything ending in ~; .meta files do not get their own .meta.
    return not (name.startswith(".") or name.endswith("~") or name.endswith(".meta"))


def main():
    check_only = "--check" in sys.argv
    missing = []
    for root, dirs, files in os.walk(ASSETS):
        dirs[:] = sorted(d for d in dirs if wanted(d))
        for d in dirs:
            missing.append((os.path.join(root, d), FOLDER))
        for f in sorted(files):
            if wanted(f):
                ext = os.path.splitext(f)[1].lower()
                missing.append((os.path.join(root, f), BY_EXT.get(ext, DEFAULT)))

    created = 0
    for path, template in missing:
        meta = path + ".meta"
        if os.path.exists(meta):
            continue
        rel = os.path.relpath(path, REPO)
        if check_only:
            print("missing: " + rel + ".meta")
        else:
            with open(meta, "w", newline="\n") as fh:
                fh.write(template.format(guid=guid_for(rel)))
            print("created: " + rel + ".meta")
        created += 1

    if created == 0:
        print("All assets have .meta files.")
    return 1 if (check_only and created) else 0


if __name__ == "__main__":
    sys.exit(main())
