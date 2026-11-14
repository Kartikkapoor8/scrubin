using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace ScrubIn
{
    /// <summary>
    /// Smooth tubes through a handful of control points: vessels, nerves, tendons, thread.
    /// UVs: U runs 0..1 along the tube by arc length (so HoloGlow's flow bands and trace-on travel along it),
    /// V runs around it. Points are in the parent's local space.
    /// </summary>
    public static class TubeBuilder
    {
        /// <summary>
        /// Samples a Catmull-Rom spline that passes through every control point.
        /// Returns (points - 1) * samplesPerSegment + 1 positions.
        /// </summary>
        public static List<Vector3> CatmullRom(IList<Vector3> controlPoints, int samplesPerSegment = 8)
        {
            List<Vector3> path = new List<Vector3>();
            int count = controlPoints.Count;
            if (count == 0) return path;
            if (count == 1)
            {
                path.Add(controlPoints[0]);
                return path;
            }

            samplesPerSegment = Mathf.Max(1, samplesPerSegment);
            for (int i = 0; i < count - 1; i++)
            {
                Vector3 p0 = controlPoints[Mathf.Max(i - 1, 0)];
                Vector3 p1 = controlPoints[i];
                Vector3 p2 = controlPoints[i + 1];
                Vector3 p3 = controlPoints[Mathf.Min(i + 2, count - 1)];

                for (int s = 0; s < samplesPerSegment; s++)
                {
                    float t = s / (float)samplesPerSegment;
                    float t2 = t * t;
                    float t3 = t2 * t;
                    path.Add(0.5f * (2f * p1
                                     + (p2 - p0) * t
                                     + (2f * p0 - 5f * p1 + 4f * p2 - p3) * t2
                                     + (3f * p1 - p0 - 3f * p2 + p3) * t3));
                }
            }
            path.Add(controlPoints[count - 1]);
            return path;
        }

        /// <summary>A tube of constant radius through the control points (smoothed with Catmull-Rom).</summary>
        public static MeshRenderer Tube(Transform parent, string name, IList<Vector3> controlPoints, float radius,
            Material material, int samplesPerSegment = 8, int sides = 8)
        {
            return Tube(parent, name, controlPoints, u => radius, material, samplesPerSegment, sides);
        }

        /// <summary>A tube whose radius varies along its length: <c>radiusAt(u)</c> with u from 0 to 1.</summary>
        public static MeshRenderer Tube(Transform parent, string name, IList<Vector3> controlPoints,
            Func<float, float> radiusAt, Material material, int samplesPerSegment = 8, int sides = 8)
        {
            GameObject go = new GameObject(name);
            go.transform.SetParent(parent, false);

            go.AddComponent<MeshFilter>().sharedMesh = BuildMesh(CatmullRom(controlPoints, samplesPerSegment), radiusAt, sides);
            MeshRenderer renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            renderer.lightProbeUsage = LightProbeUsage.Off;
            renderer.reflectionProbeUsage = ReflectionProbeUsage.Off;
            return renderer;
        }

        /// <summary>Builds the tube mesh around an already-sampled path.</summary>
        public static Mesh BuildMesh(IList<Vector3> path, Func<float, float> radiusAt, int sides = 8)
        {
            Mesh mesh = new Mesh();
            mesh.name = "Tube";
            int rings = path.Count;
            if (rings < 2) return mesh;
            sides = Mathf.Clamp(sides, 3, 32);

            // Arc length at each ring, for U.
            float[] lengthAt = new float[rings];
            for (int i = 1; i < rings; i++) lengthAt[i] = lengthAt[i - 1] + Vector3.Distance(path[i - 1], path[i]);
            float total = Mathf.Max(lengthAt[rings - 1], 1e-6f);

            int ringVerts = sides + 1;   // the seam vertex is doubled so V can run 0..1
            List<Vector3> vertices = new List<Vector3>(rings * ringVerts);
            List<Vector3> normals = new List<Vector3>(rings * ringVerts);
            List<Vector2> uvs = new List<Vector2>(rings * ringVerts);
            List<int> triangles = new List<int>((rings - 1) * sides * 6);

            // Carry the cross-section frame along the path by the smallest rotation between tangents, so the
            // tube never twists.
            Vector3 tangent = TangentAt(path, 0);
            Vector3 side = Vector3.Cross(tangent, Mathf.Abs(tangent.y) < 0.9f ? Vector3.up : Vector3.right).normalized;

            for (int i = 0; i < rings; i++)
            {
                Vector3 nextTangent = TangentAt(path, i);
                side = Quaternion.FromToRotation(tangent, nextTangent) * side;
                tangent = nextTangent;
                side = Vector3.ProjectOnPlane(side, tangent).normalized;
                Vector3 up = Vector3.Cross(tangent, side);

                float u = lengthAt[i] / total;
                float radius = Mathf.Max(radiusAt(u), 0f);

                for (int s = 0; s <= sides; s++)
                {
                    float angle = s / (float)sides * Mathf.PI * 2f;
                    Vector3 normal = side * Mathf.Cos(angle) + up * Mathf.Sin(angle);
                    vertices.Add(path[i] + normal * radius);
                    normals.Add(normal);
                    uvs.Add(new Vector2(u, s / (float)sides));
                }
            }

            for (int i = 0; i < rings - 1; i++)
            {
                int a = i * ringVerts;
                int b = (i + 1) * ringVerts;
                for (int s = 0; s < sides; s++)
                {
                    // Wound so the outside of the tube is the front face.
                    triangles.Add(a + s);
                    triangles.Add(a + s + 1);
                    triangles.Add(b + s);
                    triangles.Add(b + s);
                    triangles.Add(a + s + 1);
                    triangles.Add(b + s + 1);
                }
            }

            if (vertices.Count > 65000) mesh.indexFormat = IndexFormat.UInt32;
            mesh.SetVertices(vertices);
            mesh.SetNormals(normals);
            mesh.SetUVs(0, uvs);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateBounds();
            return mesh;
        }

        static Vector3 TangentAt(IList<Vector3> path, int i)
        {
            Vector3 a = path[Mathf.Max(i - 1, 0)];
            Vector3 b = path[Mathf.Min(i + 1, path.Count - 1)];
            Vector3 t = b - a;
            return t.sqrMagnitude > 1e-12f ? t.normalized : Vector3.right;
        }
    }
}
