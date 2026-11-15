"""Convert the MakeHuman CC0 base mesh (base.obj) into VIPER's HumanShell.bytes.

Keeps only the 'body' group, re-poses the arms from MakeHuman's A-pose to lying at the sides (upper arm 15 deg out,
forearm parallel to the body), scales to life size (1.75 m) and moves it into the patient frame
(+X head, +Y anterior/up, +Z body right) with the RIGHT WRIST at x=0,z=0 and the right forearm along -X->+X,
back resting at y=0. Cuts the surgical window out of the right forearm.
Output: int32 nVerts, int32 nTris, float32[3*nVerts], uint16[3*nTris].
Usage: python tools/body/make_shell.py <base.obj> <out.bytes>
"""
import math, struct, sys

src, dst = sys.argv[1], sys.argv[2]
V, G, g = [], {}, None
for l in open(src):
    if l.startswith('v '): V.append([float(t) for t in l.split()[1:4]])
    elif l.startswith('g '): g = l.split()[1]; G.setdefault(g, [])
    elif l.startswith('f '): G[g].append([int(t.split('/')[0]) - 1 for t in l.split()[1:]])

def joint(n):
    idx = {i for f in G[n] for i in f}
    return [sum(V[i][k] for i in idx) / len(idx) for k in range(3)]
sub = lambda a, b: [a[i] - b[i] for i in range(3)]
add = lambda a, b: [a[i] + b[i] for i in range(3)]
mul = lambda a, s: [x * s for x in a]
dot = lambda a, b: sum(a[i] * b[i] for i in range(3))
cross = lambda a, b: [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
def norm(a): l = math.sqrt(dot(a, a)); return mul(a, 1 / l)
def rot(v, axis, ang):  # Rodrigues
    c, s = math.cos(ang), math.sin(ang)
    return add(add(mul(v, c), mul(cross(axis, v), s)), mul(axis, dot(axis, v) * (1 - c)))
def smooth(e0, e1, x):
    t = min(1, max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t)
def rot_between(a, b):
    a, b = norm(a), norm(b); ax = cross(a, b); s = math.sqrt(dot(ax, ax))
    return (mul(ax, 1 / s) if s > 1e-9 else [0, 0, 1]), math.atan2(s, dot(a, b))

faces = G['body']
used = sorted({i for f in faces for i in f})
P = {i: list(V[i]) for i in used}
arm = {i: 0.0 for i in used}
BLEND = 0.35  # dm

for side, sx in (('r', -1), ('l', 1)):
    S, E, W = joint('joint-%s-shoulder' % side), joint('joint-%s-elbow' % side), joint('joint-%s-hand' % side)
    u0, f0 = norm(sub(E, S)), norm(sub(W, E))
    # upper arm 15 deg out and sloping back so the forearm rests on the table (centre ~3 cm above it)
    tz = -0.38
    t = [sx * 0.267, -math.sqrt(1 - 0.267 ** 2 - tz ** 2), tz]
    # shoulder: bisector plane between arm and torso (straight down)
    n1 = norm(sub(u0, [0, -1, 0]))
    ax1, an1 = rot_between(u0, t)
    E1 = add(S, rot(sub(E, S), ax1, an1))
    f1 = rot(f0, ax1, an1)
    n2 = norm(add(norm(f1), t))
    ax2, an2 = rot_between(f1, [0, -1, 0])
    for i in used:
        p = P[i]
        if p[0] * sx <= 0.3: continue  # wrong side of the body
        w1 = smooth(-BLEND, BLEND, dot(sub(p, S), n1))
        if w1 <= 0: continue
        arm[i] = max(arm[i], w1)
        p = add(S, rot(sub(p, S), ax1, an1 * w1))
        w2 = smooth(-BLEND, BLEND, dot(sub(p, E1), n2)) * (1 if w1 > 0.99 else w1)
        if w2 > 0: p = add(E1, rot(sub(p, E1), ax2, an2 * w2))
        P[i] = p
    if side == 'r':
        W1 = add(S, rot(sub(W, S), ax1, an1)); W2 = add(E1, rot(sub(W1, E1), ax2, an2)); RW, RE = W2, E1

# legs: bring the feet in (MakeHuman stands with feet apart) so the procedural skeleton's legs sit inside
for side, sx in (('r', -1), ('l', 1)):
    H, A = joint('joint-%s-upper-leg' % side), joint('joint-%s-ankle' % side)
    d0 = norm(sub(A, H)); d1 = norm([sx * 1.0 - H[0], A[1] - H[1], A[2] - H[2]])
    ax, an = rot_between(d0, d1)
    for i in used:
        p = P[i]
        if p[0] * sx <= 0 or p[1] > H[1] or arm[i] > 0: continue
        w = smooth(0, 1.5, H[1] - p[1]) * smooth(0, 0.4, p[0] * sx)
        P[i] = add(H, rot(sub(p, H), ax, an * w))

# life size: 1.75 m. MakeHuman units are decimeters.
ys = [P[i][1] for i in used]
s = 1.75 / (max(ys) - min(ys))
def to_patient(p):  # MH (right-handed, Y up, face +Z, character's right = -X) -> patient frame
    return [p[1] * s, p[2] * s, -p[0] * s]
Q = {i: to_patient(P[i]) for i in used}
w = to_patient(RW)
ymin = min(q[1] for q in Q.values())
for i in used: Q[i] = [Q[i][0] - w[0], Q[i][1] - ymin, Q[i][2] - w[2]]
e = to_patient(RE); print('right forearm length %.3f m' % (e[0] - w[0]), 'height', round(max(ys)*s - min(ys)*s, 3))
mid = sum(Q[i][2] for i in used if arm[i] == 0) / sum(1 for i in used if arm[i] == 0)
print('body midline z %.3f (procedural body: -0.24)' % mid)

# triangulate + surgical window
X0, X1 = 0.082, 0.160
remap = {i: k for k, i in enumerate(used)}
tris, cut = [], 0
for f in faces:
    for tri in ((f[0], f[1], f[2]), (f[0], f[2], f[3])):
        c = [sum(Q[i][k] for i in tri) / 3 for k in range(3)]
        if X0 < c[0] < X1 and abs(c[2]) < 0.06 and min(arm[i] for i in tri) > 0.5: cut += 1; continue
        tris.append(tri)
# winding: Unity front face = Cross(b-a, c-a) outward. Check at the top of the head (max X).
top = max(tris, key=lambda tr: sum(Q[i][0] for i in tr))
n = cross(sub(Q[top[1]], Q[top[0]]), sub(Q[top[2]], Q[top[0]]))
flip = n[0] < 0
out = bytearray(struct.pack('<ii', len(used), len(tris)))
for i in used: out += struct.pack('<3f', *Q[i])
for tr in tris:
    tr = (tr[0], tr[2], tr[1]) if flip else tr
    out += struct.pack('<3H', *(remap[i] for i in tr))
open(dst, 'wb').write(out)
xs = [q[0] for q in Q.values()]; zs = [q[2] for q in Q.values()]
print('verts', len(used), 'tris', len(tris), 'window tris cut', cut, 'flip', flip,
      'x %.2f..%.2f z %.2f..%.2f' % (min(xs), max(xs), min(zs), max(zs)), 'bytes', len(out))
