using System.Collections.Generic;
using UnityEngine;

namespace ScrubIn
{
    /// <summary>
    /// The alignment aid: a glowing contour cage of the forearm, the wound position, an axis gizmo at the
    /// wrist and wrist / elbow / thumb labels. Visible while alignment is unlocked so the operator can sit it
    /// on the real arm; fades out when alignment is locked.
    /// </summary>
    public class ArmOutline : MonoBehaviour
    {
        const float LabelCapHeight = 0.010f;   // 1 cm capitals: readable at 0.7 m on a HoloLens

        readonly List<HoloElement> _elements = new List<HoloElement>();
        readonly List<float> _delays = new List<float>();
        readonly List<float> _durations = new List<float>();

        public static ArmOutline Build(ScrubInContext ctx)
        {
            GameObject go = new GameObject("ArmOutline");
            go.transform.SetParent(ctx.PatientRoot, false);
            ArmOutline outline = go.AddComponent<ArmOutline>();
            outline.Construct(ctx);
            return outline;
        }

        void Construct(ScrubInContext ctx)
        {
            WoundData wound = ctx.Procedure.wound;

            Material edgeMaterial = HoloMaterials.Line(Palette.Cyan, 1f);
            Material ribMaterial = HoloMaterials.Line(Palette.Cyan, 0.55f);

            BuildEdges(edgeMaterial, ribMaterial);
            BuildRibs(edgeMaterial, ribMaterial);
            BuildWoundMarker(wound);
            BuildAxisGizmo();
            BuildLabels();

            ScrubInEvents.AlignmentLocked += OnAlignmentLocked;
        }

        void OnDestroy()
        {
            ScrubInEvents.AlignmentLocked -= OnAlignmentLocked;
        }

        void OnAlignmentLocked(bool locked)
        {
            for (int i = 0; i < _elements.Count; i++)
            {
                if (locked) _elements[i].Hide(0f, 0.25f);
                else _elements[i].Show(_delays[i], _durations[i]);
            }
        }

        // The two long edges of the arm as seen from above (its widest points), wrist to elbow, plus a short
        // flare past the wrist where the hand begins, so the wrist end is unmistakable.
        void BuildEdges(Material edgeMaterial, Material ribMaterial)
        {
            const int samples = 40;
            for (int side = 0; side < 2; side++)
            {
                float angle = side == 0 ? 0f : Mathf.PI;
                float sign = side == 0 ? 1f : -1f;
                Transform group = Group(side == 0 ? "Edge thumb side" : "Edge little-finger side");

                List<Vector3> points = new List<Vector3>(samples + 1);
                for (int i = 0; i <= samples; i++)
                {
                    points.Add(ForearmShape.Ring(ForearmShape.Length * i / samples, angle));
                }
                LineBuilder.Polyline(group, "Edge", points, edgeMaterial, LineBuilder.Primary);

                Vector3 wristEdge = ForearmShape.Ring(0f, angle);
                Vector3 handEdge = wristEdge + new Vector3(-0.035f, 0f, sign * 0.010f);
                LineBuilder.Segment(group, "Hand flare", wristEdge, handEdge, ribMaterial, LineBuilder.Fine);

                Register(HoloElement.On(group.gameObject, true), 0f, 0.9f);
            }
        }

        // Contour arcs over the top of the arm, edge to edge, like the lines a scanner would leave.
        void BuildRibs(Material edgeMaterial, Material ribMaterial)
        {
            const int ribs = 9;
            const int segments = 28;
            for (int i = 0; i < ribs; i++)
            {
                float x = ForearmShape.Length * i / (ribs - 1);
                bool end = i == 0 || i == ribs - 1;
                Transform group = Group("Rib " + i);

                List<Vector3> points = new List<Vector3>(segments + 1);
                for (int s = 0; s <= segments; s++)
                {
                    points.Add(ForearmShape.Ring(x, Mathf.PI * s / segments));
                }
                LineBuilder.Polyline(group, "Arc", points, end ? edgeMaterial : ribMaterial,
                    end ? LineBuilder.Primary * 0.8f : LineBuilder.Fine);

                Register(HoloElement.On(group.gameObject, true), 0.25f + 0.06f * i, 0.5f);
            }
        }

        // Where the laceration is: draw the marker line on the real arm here.
        void BuildWoundMarker(WoundData wound)
        {
            Transform group = Group("Wound marker");
            Vector3 lift = Vector3.up * 0.0006f;   // just clear of the skin

            const int samples = 8;
            List<Vector3> points = new List<Vector3>(samples + 1);
            for (int i = 0; i <= samples; i++)
            {
                float x = Mathf.Lerp(wound.xStart, wound.xEnd, i / (float)samples);
                points.Add(ForearmShape.Surface(x, wound.z) + lift);
            }
            LineBuilder.Polyline(group, "Wound line", points, HoloMaterials.Dashed(Palette.Amber, 9f, 1.2f), LineBuilder.Primary);

            Material tickMaterial = HoloMaterials.Line(Palette.Amber, 1.2f);
            const float tick = 0.004f;
            LineBuilder.Segment(group, "Tick start",
                ForearmShape.Surface(wound.xStart, wound.z - tick) + lift,
                ForearmShape.Surface(wound.xStart, wound.z + tick) + lift, tickMaterial, LineBuilder.Fine);
            LineBuilder.Segment(group, "Tick end",
                ForearmShape.Surface(wound.xEnd, wound.z - tick) + lift,
                ForearmShape.Surface(wound.xEnd, wound.z + tick) + lift, tickMaterial, LineBuilder.Fine);

            Vector3 center = ForearmShape.Surface(wound.CenterX, wound.z) + lift;
            LabelBuilder.Create(group, "WOUND " + wound.label, center + new Vector3(0f, 0.012f, -0.065f), LabelCapHeight, Palette.White)
                .WithLeader(center, Palette.Amber);

            Register(HoloElement.On(group.gameObject), 0.9f, 0.5f);
        }

        // The patient frame's axes, drawn on the wrist: red X toward the elbow, green Y up, blue Z toward the thumb.
        void BuildAxisGizmo()
        {
            Transform group = Group("Axis gizmo");
            Vector3 origin = ForearmShape.Surface(0f, 0f) + Vector3.up * 0.001f;

            Arrow(group, "X to elbow", origin, Vector3.right, Vector3.forward, 0.05f, Palette.Red);
            Arrow(group, "Y up", origin, Vector3.up, Vector3.right, 0.03f, Palette.Green);
            Arrow(group, "Z to thumb", origin, Vector3.forward, Vector3.right, 0.03f, Palette.Blue);
            LineBuilder.Dot(group, "Origin", origin, HoloMaterials.Disc(Palette.White, 1f), 0.006f);

            Register(HoloElement.On(group.gameObject), 1.0f, 0.5f);
        }

        static void Arrow(Transform parent, string name, Vector3 from, Vector3 direction, Vector3 headAxis,
            float length, Color color)
        {
            Material material = HoloMaterials.Line(color, 1.1f);
            Vector3 tip = from + direction * length;
            const float head = 0.007f;

            LineBuilder.Segment(parent, name, from, tip, material, 0.002f);
            LineBuilder.Polyline(parent, name + " head", new[]
            {
                tip - direction * head + headAxis * (head * 0.5f),
                tip,
                tip - direction * head - headAxis * (head * 0.5f)
            }, material, 0.002f);
        }

        void BuildLabels()
        {
            Transform group = Group("Labels");
            float length = ForearmShape.Length;

            LabelBuilder.Create(group, "WRIST",
                new Vector3(-0.050f, ForearmShape.SurfaceY(0f, 0f) + 0.015f, 0f), LabelCapHeight, Palette.Cyan);
            LabelBuilder.Create(group, "ELBOW",
                new Vector3(length + 0.050f, ForearmShape.SurfaceY(length, 0f) + 0.015f, 0f), LabelCapHeight, Palette.Cyan);
            LabelBuilder.Create(group, "THUMB SIDE",
                new Vector3(0.050f, ForearmShape.CenterY(0.050f) + 0.015f, ForearmShape.HalfWidth(0.050f) + 0.035f),
                LabelCapHeight, Palette.Cyan);

            Register(HoloElement.On(group.gameObject), 1.1f, 0.5f);
        }

        Transform Group(string name)
        {
            GameObject go = new GameObject(name);
            go.transform.SetParent(transform, false);
            return go.transform;
        }

        void Register(HoloElement element, float delay, float duration)
        {
            _elements.Add(element);
            _delays.Add(delay);
            _durations.Add(duration);
        }
    }
}
