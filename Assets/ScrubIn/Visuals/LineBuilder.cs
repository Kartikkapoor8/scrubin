using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace ScrubIn
{
    /// <summary>
    /// Thin glowing lines and dots: the main drawing tool for holograms. Points are in the parent's local
    /// space. Use materials from HoloMaterials (Line / Dashed for lines, Disc / Ring for dots).
    /// </summary>
    public static class LineBuilder
    {
        /// <summary>Width for primary contours: reads clearly at 0.7 m on a HoloLens.</summary>
        public const float Primary = 0.003f;

        /// <summary>Width for fine detail.</summary>
        public const float Fine = 0.0015f;

        static Mesh _quad;

        /// <summary>A camera-facing glowing polyline through <c>localPoints</c>.</summary>
        public static LineRenderer Polyline(Transform parent, string name, IList<Vector3> localPoints,
            Material material, float width, bool loop = false)
        {
            GameObject go = new GameObject(name);
            go.transform.SetParent(parent, false);

            LineRenderer line = go.AddComponent<LineRenderer>();
            line.useWorldSpace = false;
            line.sharedMaterial = material;
            line.alignment = LineAlignment.View;
            line.textureMode = LineTextureMode.Stretch;   // U runs 0..1 along the whole line (trace-on, dashes)
            line.widthMultiplier = width;
            line.numCornerVertices = 3;
            line.numCapVertices = 2;
            line.loop = loop;
            line.shadowCastingMode = ShadowCastingMode.Off;
            line.receiveShadows = false;
            line.lightProbeUsage = LightProbeUsage.Off;
            line.reflectionProbeUsage = ReflectionProbeUsage.Off;

            line.positionCount = localPoints.Count;
            for (int i = 0; i < localPoints.Count; i++) line.SetPosition(i, localPoints[i]);
            return line;
        }

        /// <summary>A straight glowing segment.</summary>
        public static LineRenderer Segment(Transform parent, string name, Vector3 from, Vector3 to,
            Material material, float width)
        {
            return Polyline(parent, name, new[] { from, to }, material, width);
        }

        /// <summary>
        /// A flat square facing <c>localNormal</c>, <c>size</c> meters across, for Disc and Ring materials:
        /// a marker lying on the skin, for example.
        /// </summary>
        public static MeshRenderer Quad(Transform parent, string name, Vector3 localPosition, Vector3 localNormal,
            Material material, float size)
        {
            GameObject go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPosition;
            go.transform.localRotation = FacingRotation(localNormal);
            go.transform.localScale = new Vector3(size, size, size);

            go.AddComponent<MeshFilter>().sharedMesh = QuadMesh();
            MeshRenderer renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            renderer.lightProbeUsage = LightProbeUsage.Off;
            renderer.reflectionProbeUsage = ReflectionProbeUsage.Off;
            return renderer;
        }

        /// <summary>A glowing dot (or ring) that always faces the viewer, <c>diameter</c> meters across.</summary>
        public static MeshRenderer Dot(Transform parent, string name, Vector3 localPosition, Material material,
            float diameter)
        {
            MeshRenderer renderer = Quad(parent, name, localPosition, Vector3.up, material, diameter);
            renderer.gameObject.AddComponent<FaceViewer>();
            return renderer;
        }

        /// <summary>
        /// Points along an ellipse arc: centre + axisA * cos(angle) * radiusA + axisB * sin(angle) * radiusB,
        /// from startDeg to endDeg inclusive.
        /// </summary>
        public static List<Vector3> Arc(Vector3 center, Vector3 axisA, Vector3 axisB, float radiusA, float radiusB,
            float startDeg, float endDeg, int segments)
        {
            segments = Mathf.Max(1, segments);
            List<Vector3> points = new List<Vector3>(segments + 1);
            for (int i = 0; i <= segments; i++)
            {
                float angle = Mathf.Lerp(startDeg, endDeg, i / (float)segments) * Mathf.Deg2Rad;
                points.Add(center + axisA * (Mathf.Cos(angle) * radiusA) + axisB * (Mathf.Sin(angle) * radiusB));
            }
            return points;
        }

        /// <summary>Points around a circle lying in the plane with the given normal (use with loop = true).</summary>
        public static List<Vector3> Circle(Vector3 center, Vector3 normal, float radius, int segments)
        {
            Quaternion rotation = FacingRotation(normal);
            Vector3 a = rotation * Vector3.right;
            Vector3 b = rotation * Vector3.up;
            segments = Mathf.Max(3, segments);
            List<Vector3> points = new List<Vector3>(segments);
            for (int i = 0; i < segments; i++)
            {
                float angle = i / (float)segments * Mathf.PI * 2f;
                points.Add(center + (a * Mathf.Cos(angle) + b * Mathf.Sin(angle)) * radius);
            }
            return points;
        }

        // A rotation whose Z axis points along 'normal' (the quad mesh faces +Z and -Z alike; cull is off).
        static Quaternion FacingRotation(Vector3 normal)
        {
            if (normal.sqrMagnitude < 1e-10f) return Quaternion.identity;
            Vector3 n = normal.normalized;
            Vector3 up = Mathf.Abs(Vector3.Dot(n, Vector3.up)) > 0.99f ? Vector3.right : Vector3.up;
            return Quaternion.LookRotation(n, up);
        }

        // A unit square in the XY plane, centred, with UVs 0..1 (the Disc and Ring shapes are drawn from the UVs).
        static Mesh QuadMesh()
        {
            if (_quad != null) return _quad;

            Mesh mesh = new Mesh();
            mesh.name = "HoloQuad";
            mesh.vertices = new[]
            {
                new Vector3(-0.5f, -0.5f, 0f), new Vector3(0.5f, -0.5f, 0f),
                new Vector3(0.5f, 0.5f, 0f), new Vector3(-0.5f, 0.5f, 0f)
            };
            mesh.uv = new[] { new Vector2(0f, 0f), new Vector2(1f, 0f), new Vector2(1f, 1f), new Vector2(0f, 1f) };
            mesh.normals = new[] { Vector3.back, Vector3.back, Vector3.back, Vector3.back };
            mesh.triangles = new[] { 0, 2, 1, 0, 3, 2 };
            mesh.RecalculateBounds();
            _quad = mesh;
            return _quad;
        }
    }

    /// <summary>Keeps an object turned toward the viewer's head (dots, labels).</summary>
    public class FaceViewer : MonoBehaviour
    {
        void LateUpdate()
        {
            ScrubInContext ctx = ScrubInContext.Current;
            if (ctx == null || ctx.Head == null) return;

            Vector3 away = transform.position - ctx.Head.position;
            if (away.sqrMagnitude < 1e-6f) return;
            transform.rotation = Quaternion.LookRotation(away, Vector3.up);
        }
    }
}
