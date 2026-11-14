using System.Collections.Generic;
using UnityEngine;

namespace ScrubIn
{
    /// <summary>
    /// The holographic forearm. While alignment is unlocked it is the alignment aid: a glowing contour cage,
    /// the wound position, an axis gizmo at the wrist, labels and a "tap to place" prompt. Once placed
    /// (locked) the guides fade away and a quieter cage stays on the arm as the hologram the wearer works on.
    /// The contours over the wound itself are dropped once placed, so nothing is drawn on top of the marker
    /// line that VIPER Vision tracks.
    ///
    /// Layer "holoWound" (operator key W, or options.holoWound) adds a bright hologram wound line once placed,
    /// for running with no real arm.
    /// </summary>
    public class ArmOutline : MonoBehaviour
    {
        public const string HoloWoundLayer = "holoWound";

        const float LabelCapHeight = 0.010f;   // 1 cm capitals: readable at 0.7 m on a HoloLens
        const float PlacedBrightness = 0.6f;   // the cage that stays once placed

        enum Role
        {
            Cage,    // stays (dimmer) once placed
            Guide    // alignment only: hidden once placed
        }

        readonly List<HoloElement> _elements = new List<HoloElement>();
        readonly List<Role> _roles = new List<Role>();
        readonly List<float> _delays = new List<float>();
        readonly List<float> _durations = new List<float>();

        HoloElement _holoWound;
        bool _holoWoundOn;
        bool _locked;

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
            ProcedureData data = ctx.Procedure;
            WoundData wound = data.wound;

            Material edgeMaterial = HoloMaterials.Line(Palette.Cyan, 1f);
            Material ribMaterial = HoloMaterials.Line(Palette.Cyan, 0.55f);

            BuildEdges(edgeMaterial, ribMaterial);
            BuildRibs(edgeMaterial, ribMaterial, wound);
            BuildWoundMarker(wound);
            BuildAxisGizmo();
            BuildLabels(data);
            BuildHoloWound(wound, data.options);

            _holoWoundOn = data.options.holoWound;
            ScrubInEvents.AlignmentLocked += OnAlignmentLocked;
            ScrubInEvents.LayerVisibility += OnLayerVisibility;
        }

        void OnDestroy()
        {
            ScrubInEvents.AlignmentLocked -= OnAlignmentLocked;
            ScrubInEvents.LayerVisibility -= OnLayerVisibility;
        }

        void OnAlignmentLocked(bool locked)
        {
            _locked = locked;
            for (int i = 0; i < _elements.Count; i++)
            {
                if (!locked) _elements[i].Show(_delays[i], _durations[i]);
                else if (_roles[i] == Role.Cage) _elements[i].FadeTo(PlacedBrightness, 0.5f);
                else _elements[i].Hide(0f, 0.25f);
            }
            RefreshHoloWound();
        }

        void OnLayerVisibility(string layer, bool visible)
        {
            if (layer != HoloWoundLayer) return;
            _holoWoundOn = visible;
            RefreshHoloWound();
        }

        void RefreshHoloWound()
        {
            bool show = _locked && _holoWoundOn;
            if (show == _holoWound.IsShown) return;
            if (show) _holoWound.Show(0.2f, 0.6f);
            else _holoWound.Hide();
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

                Register(HoloElement.On(group.gameObject, true), Role.Cage, 0f, 0.9f);
            }
        }

        // Contour arcs over the top of the arm, edge to edge, like the lines a scanner would leave. The arcs
        // that cross the wound are guides only: they go away once the outline is placed.
        void BuildRibs(Material edgeMaterial, Material ribMaterial, WoundData wound)
        {
            const int ribs = 9;
            const int segments = 28;
            const float clearance = 0.012f;
            for (int i = 0; i < ribs; i++)
            {
                float x = ForearmShape.Length * i / (ribs - 1);
                bool end = i == 0 || i == ribs - 1;
                bool overWound = x > wound.xStart - clearance && x < wound.xEnd + clearance;
                Transform group = Group("Rib " + i);

                List<Vector3> points = new List<Vector3>(segments + 1);
                for (int s = 0; s <= segments; s++)
                {
                    points.Add(ForearmShape.Ring(x, Mathf.PI * s / segments));
                }
                LineBuilder.Polyline(group, "Arc", points, end ? edgeMaterial : ribMaterial,
                    end ? LineBuilder.Primary * 0.8f : LineBuilder.Fine);

                Register(HoloElement.On(group.gameObject, true), overWound ? Role.Guide : Role.Cage, 0.25f + 0.06f * i, 0.5f);
            }
        }

        // Where the laceration is: draw the marker line on the real arm here.
        void BuildWoundMarker(WoundData wound)
        {
            Transform group = Group("Wound marker");
            Vector3 lift = Vector3.up * 0.0006f;   // just clear of the skin

            LineBuilder.Polyline(group, "Wound line", WoundPoints(wound, lift), HoloMaterials.Dashed(Palette.Amber, 9f, 1.2f), LineBuilder.Primary);

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

            Register(HoloElement.On(group.gameObject), Role.Guide, 0.9f, 0.5f);
        }

        // A solid, bright wound line for when there is no real arm (and no marker line) to track.
        void BuildHoloWound(WoundData wound, OptionsData options)
        {
            Transform group = Group("Hologram wound");
            Color color;
            if (!ColorUtility.TryParseHtmlString("#" + options.holoWoundColor.TrimStart('#'), out color))
            {
                color = new Color(0.224f, 1f, 0.078f);
            }
            LineBuilder.Polyline(group, "Wound", WoundPoints(wound, Vector3.up * 0.0006f), HoloMaterials.Line(color, 1.6f), 0.0045f);
            _holoWound = HoloElement.On(group.gameObject, true);
        }

        static List<Vector3> WoundPoints(WoundData wound, Vector3 lift)
        {
            const int samples = 8;
            List<Vector3> points = new List<Vector3>(samples + 1);
            for (int i = 0; i <= samples; i++)
            {
                float x = Mathf.Lerp(wound.xStart, wound.xEnd, i / (float)samples);
                points.Add(ForearmShape.Surface(x, wound.z) + lift);
            }
            return points;
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

            Register(HoloElement.On(group.gameObject), Role.Guide, 1.0f, 0.5f);
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

        void BuildLabels(ProcedureData data)
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

            // What to do next, floating above the middle of the arm until the outline is placed.
            if (!string.IsNullOrEmpty(data.prompts.place))
            {
                LabelBuilder.Create(group, data.prompts.place,
                    new Vector3(length * 0.5f, 0.070f, 0.030f), LabelCapHeight, Palette.White);
            }

            Register(HoloElement.On(group.gameObject), Role.Guide, 1.1f, 0.5f);
        }

        Transform Group(string name)
        {
            GameObject go = new GameObject(name);
            go.transform.SetParent(transform, false);
            return go.transform;
        }

        void Register(HoloElement element, Role role, float delay, float duration)
        {
            _elements.Add(element);
            _roles.Add(role);
            _delays.Add(delay);
            _durations.Add(duration);
        }
    }
}
