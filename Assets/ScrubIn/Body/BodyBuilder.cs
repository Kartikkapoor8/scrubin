using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace ScrubIn
{
    /// <summary>
    /// Builds a life-size holographic body lying face up on the table, entirely from code, in the patient frame:
    /// +X toward the head, +Y up (anterior), +Z the body's right side. The body's RIGHT FOREARM is exactly the
    /// forearm of the patient frame (ForearmShape: wrist at x = 0, elbow at x = 0.26, palm up), so aligning the
    /// patient frame to a real arm lines this forearm up over it.
    ///
    /// Four layers of named parts: skin (translucent shell), muscles, skeleton, organs. A "surgical window" on
    /// the right forearm (around the wound) is cut out of every layer so the real arm and its marker line show
    /// through untouched in the Mixed Reality Capture stream. No green anywhere (the Mac tracks a green line).
    /// About 35k triangles in total; any one view draws well under the HoloLens 1 budget.
    /// </summary>
    public static class BodyBuilder
    {
        // ---- Layout (meters) -------------------------------------------------------------------------------
        static float T { get { return ForearmShape.TableY; } }   // table height (about -0.05)
        const float MidZ = -0.24f;          // body midline: the right arm (z = 0) lies 0.24 m to the right of it
        const float ArmDz = 0.24f;          // forearm distance from the midline

        // Surgical window on the right forearm, around the wound (patient frame).
        public const float WindowX0 = 0.082f, WindowX1 = 0.160f;
        static float WindowHalfZ { get { return ForearmShape.HalfWidth(0.12f) * 0.85f; } }

        // ---- Colors (bright, warm, no green) ----------------------------------------------------------------
        public static readonly Color SkinColor = Palette.Hex(0xFFD9C2);
        public static readonly Color ShellColor = Palette.Hex(0x8FC4FF);   // ice blue hologram (no green)
        public static readonly Color MuscleColor = Palette.Hex(0xFF6B5A);
        public static readonly Color BoneColor = Palette.Bone;

        public class Model
        {
            public Transform Root;
            public readonly List<BodyPart> Parts = new List<BodyPart>();
            public int Triangles;
            public BodyMode Mode = BodyMode.Skin;

            public void ApplyMode(BodyMode mode)
            {
                Mode = mode;
                for (int i = 0; i < Parts.Count; i++)
                {
                    BodyPart p = Parts[i];
                    bool skin = p.Layer == BodyLayer.Skin;
                    switch (mode)
                    {
                        case BodyMode.Skin:   // translucent shell with the skeleton visible inside
                            p.SetMode(skin || p.Layer == BodyLayer.Skeleton, skin ? 1f : 0.6f, skin);
                            break;
                        case BodyMode.Muscles:
                            p.SetMode(skin || p.Layer == BodyLayer.Muscle, skin ? 0.22f : 1f, !skin);
                            break;
                        case BodyMode.Skeleton:
                            p.SetMode(skin || p.Layer == BodyLayer.Skeleton, skin ? 0.22f : 1f, !skin);
                            break;
                        case BodyMode.Organs:
                            p.SetMode(skin || p.Layer == BodyLayer.Organ, skin ? 0.22f : 1f, !skin);
                            break;
                        default: // X-ray: bones + organs inside a faint skin
                            bool inner = p.Layer == BodyLayer.Skeleton || p.Layer == BodyLayer.Organ;
                            p.SetMode(skin || inner, skin ? 0.18f : (p.Layer == BodyLayer.Skeleton ? 0.75f : 0.9f), inner);
                            break;
                    }
                }
            }
        }

        static Material _skinMat, _muscleMat, _boneMat, _organMat, _windowMat;
        static Model _model;

        public static Model Build(Transform parent)
        {
            _model = new Model();
            GameObject rootGo = new GameObject("Body");
            rootGo.transform.SetParent(parent, false);
            _model.Root = rootGo.transform;

            _skinMat = HoloMaterials.Solid(SkinColor, 0.9f, 0.07f, 1.5f);
            _skinMat.name = "BodySkin";
            _muscleMat = HoloMaterials.Solid(MuscleColor, 1f, 0.20f, 1.1f);
            _muscleMat.name = "BodyMuscle";
            _boneMat = HoloMaterials.Solid(BoneColor, 1f, 0.26f, 0.9f);
            _boneMat.name = "BodyBone";
            _organMat = HoloMaterials.Solid(Color.white, 1f, 0.30f, 1.0f);
            _organMat.name = "BodyOrgan";

            Transform skin = Group("Skin"), muscle = Group("Muscles"), bone = Group("Skeleton"), organ = Group("Organs");
            if (BuildHumanShell(skin))
            {
                _skinMat = HoloMaterials.Solid(ShellColor, 1f, 0.035f, 2.4f);
                _skinMat.name = "BodyShell";
                skin.GetChild(0).GetComponent<MeshRenderer>().sharedMaterial = _skinMat;
            }
            else BuildSkin(skin);
            BuildMuscles(muscle);
            BuildSkeleton(bone);
            BuildOrgans(organ);
            BuildWindowOutline(_model.Root);

            _model.ApplyMode(BodyMode.Skin);
            Model m = _model;
            _model = null;
            return m;
        }

        // =====================================================================================================
        // Skin
        // =====================================================================================================

        // Torso cross-section: half width (Z), half height (Y) along x (hips at 0.02, shoulders at 0.56).
        static float TorsoHalfW(float x) { return Profile(x, new[] { 0.02f, 0.10f, 0.20f, 0.32f, 0.44f, 0.56f }, new[] { 0.165f, 0.160f, 0.138f, 0.150f, 0.172f, 0.180f }); }
        static float TorsoHalfH(float x) { return Profile(x, new[] { 0.02f, 0.10f, 0.20f, 0.32f, 0.44f, 0.56f }, new[] { 0.095f, 0.098f, 0.088f, 0.100f, 0.108f, 0.085f }); }
        static float TorsoCY(float x) { return T + TorsoHalfH(x); }
        static float TorsoTop(float x) { return TorsoCY(x) + TorsoHalfH(x); }

        // Real human mesh: MakeHuman base mesh (CC0), converted by tools/body/make_shell.py into the patient frame
        // (right wrist at the origin, back at y = 0, arms at the sides, surgical window already cut).
        static bool BuildHumanShell(Transform g)
        {
            TextAsset ta = Resources.Load<TextAsset>("HumanShell");
            if (ta == null) { ScrubInLog.Warn("HumanShell mesh missing; using the procedural skin."); return false; }
            try
            {
                byte[] b = ta.bytes;
                int nv = BitConverter.ToInt32(b, 0), nt = BitConverter.ToInt32(b, 4), o = 8;
                Vector3[] v = new Vector3[nv];
                for (int i = 0; i < nv; i++, o += 12)
                    v[i] = new Vector3(BitConverter.ToSingle(b, o), BitConverter.ToSingle(b, o + 4) + T, BitConverter.ToSingle(b, o + 8));
                int[] tri = new int[nt * 3];
                for (int i = 0; i < tri.Length; i++, o += 2) tri[i] = BitConverter.ToUInt16(b, o);
                Mesh m = new Mesh();
                m.name = "HumanShell";
                m.vertices = v;
                m.triangles = tri;
                m.RecalculateNormals();
                m.RecalculateBounds();
                Part(g, BodyLayer.Skin, "Body", ShellColor, 1f, m);
                return g.childCount > 0;
            }
            catch (Exception e)
            {
                ScrubInLog.Warn("HumanShell mesh unreadable (" + e.Message + "); using the procedural skin.");
                return false;
            }
        }

        static void BuildSkin(Transform g)
        {
            Part(g, BodyLayer.Skin, "Torso", SkinColor, 0.9f,
                LoftX(0.0f, 0.585f, 28, 28, TorsoHalfW, TorsoHalfH, TorsoCY, x => MidZ, 0.06f));
            Part(g, BodyLayer.Skin, "Neck", SkinColor, 0.9f,
                LoftX(0.55f, 0.665f, 6, 16, x => 0.055f, x => 0.05f, x => T + 0.06f, x => MidZ, 0.0f));
            Part(g, BodyLayer.Skin, "Head", SkinColor, 0.9f,
                LoftX(0.635f, 0.865f, 18, 22, x => 0.080f, x => 0.096f, x => T + 0.098f, x => MidZ, 0.5f));

            for (int s = -1; s <= 1; s += 2)
            {
                bool right = s > 0;
                string side = right ? "Right " : "Left ";
                float armZ = MidZ + s * ArmDz;

                // Forearm: ForearmShape is the source of truth (the right one is the alignment target).
                Part(g, BodyLayer.Skin, side + "forearm", SkinColor, 0.9f,
                    LoftX(-0.005f, 0.275f, 44, 30, ForearmShape.HalfWidth, ForearmShape.HalfHeight, ForearmShape.CenterY, x => armZ, 0.04f));
                Part(g, BodyLayer.Skin, side + "upper arm", SkinColor, 0.9f,
                    LoftX(0.24f, 0.58f, 14, 16, x => Mathf.Lerp(0.040f, 0.048f, (x - 0.24f) / 0.34f), x => Mathf.Lerp(0.034f, 0.046f, (x - 0.24f) / 0.34f),
                          x => T + Mathf.Lerp(0.034f, 0.046f, (x - 0.24f) / 0.34f), x => MidZ + s * Mathf.Lerp(ArmDz, 0.205f, (x - 0.24f) / 0.34f), 0.08f));
                Part(g, BodyLayer.Skin, side + "hand", SkinColor, 0.9f,
                    LoftX(-0.20f, 0.01f, 12, 14, x => Profile(x, new[] { -0.20f, -0.12f, -0.03f, 0.01f }, new[] { 0.030f, 0.046f, 0.044f, 0.034f }),
                          x => Profile(x, new[] { -0.20f, -0.10f, 0.01f }, new[] { 0.008f, 0.016f, 0.019f }),
                          x => T + 0.018f, x => armZ + s * 0.006f, 0.12f));

                float legZ = MidZ + s * 0.09f;
                Part(g, BodyLayer.Skin, side + "thigh", SkinColor, 0.9f,
                    LoftX(-0.44f, 0.04f, 16, 18, x => Mathf.Lerp(0.052f, 0.088f, (x + 0.44f) / 0.48f), x => Mathf.Lerp(0.050f, 0.082f, (x + 0.44f) / 0.48f),
                          x => T + Mathf.Lerp(0.050f, 0.082f, (x + 0.44f) / 0.48f), x => legZ, 0.06f));
                Part(g, BodyLayer.Skin, side + "lower leg", SkinColor, 0.9f,
                    LoftX(-0.84f, -0.40f, 16, 16, x => Profile(x, new[] { -0.84f, -0.70f, -0.56f, -0.40f }, new[] { 0.032f, 0.040f, 0.050f, 0.050f }),
                          x => Profile(x, new[] { -0.84f, -0.70f, -0.56f, -0.40f }, new[] { 0.030f, 0.040f, 0.050f, 0.048f }),
                          x => T + Profile(x, new[] { -0.84f, -0.70f, -0.56f, -0.40f }, new[] { 0.030f, 0.040f, 0.050f, 0.048f }), x => legZ, 0.06f));
                // Face up, so the feet point up: an upright ellipsoid at the ankle.
                Part(g, BodyLayer.Skin, side + "foot", SkinColor, 0.9f,
                    Ellipsoid(new Vector3(-0.875f, T + 0.105f, legZ + s * 0.005f), new Vector3(0.045f, 0.105f, 0.042f), Quaternion.Euler(0f, 0f, 12f), 14, 10));
            }
        }

        // =====================================================================================================
        // Muscles
        // =====================================================================================================

        static void BuildMuscles(Transform g)
        {
            Color c = MuscleColor;
            Part(g, BodyLayer.Muscle, "Rectus abdominis", c, 1f,
                LoftX(0.05f, 0.36f, 12, 12, x => 0.055f, x => 0.012f, x => TorsoTop(x) - 0.016f, x => MidZ, 0.12f));
            Part(g, BodyLayer.Muscle, "Sternocleidomastoid (right)", c, 1f,
                Tube(new[] { new Vector3(0.685f, T + 0.07f, MidZ + 0.055f), new Vector3(0.63f, T + 0.11f, MidZ + 0.03f), new Vector3(0.57f, T + 0.15f, MidZ + 0.015f) }, u => 0.011f, 4, 6));
            Part(g, BodyLayer.Muscle, "Sternocleidomastoid (left)", c, 1f,
                Tube(new[] { new Vector3(0.685f, T + 0.07f, MidZ - 0.055f), new Vector3(0.63f, T + 0.11f, MidZ - 0.03f), new Vector3(0.57f, T + 0.15f, MidZ - 0.015f) }, u => 0.011f, 4, 6));

            for (int s = -1; s <= 1; s += 2)
            {
                string side = s > 0 ? " (right)" : " (left)";
                float armZ = MidZ + s * ArmDz;
                float legZ = MidZ + s * 0.09f;

                Part(g, BodyLayer.Muscle, "Pectoralis major" + side, c, 1f,
                    Ellipsoid(new Vector3(0.465f, TorsoTop(0.465f) - 0.022f, MidZ + s * 0.085f), new Vector3(0.068f, 0.020f, 0.080f), Quaternion.Euler(0f, s * 15f, 0f), 14, 10));
                Part(g, BodyLayer.Muscle, "External oblique" + side, c, 1f,
                    Ellipsoid(new Vector3(0.22f, TorsoCY(0.22f) + 0.03f, MidZ + s * 0.115f), new Vector3(0.095f, 0.045f, 0.030f), Quaternion.Euler(s * 25f, 0f, 0f), 14, 10));
                Part(g, BodyLayer.Muscle, "Deltoid" + side, c, 1f,
                    Ellipsoid(new Vector3(0.535f, T + 0.07f, MidZ + s * 0.200f), new Vector3(0.060f, 0.048f, 0.044f), Quaternion.identity, 12, 10));
                Part(g, BodyLayer.Muscle, "Biceps brachii" + side, c, 1f,
                    LoftX(0.29f, 0.50f, 10, 10, x => 0.024f, x => 0.020f, x => T + 0.060f, x => MidZ + s * Mathf.Lerp(0.235f, 0.21f, (x - 0.29f) / 0.21f), 0.3f));
                Part(g, BodyLayer.Muscle, "Forearm flexors" + side, c, 1f,
                    LoftX(0.03f, 0.245f, 12, 10, x => ForearmShape.HalfWidth(x) * 0.62f, x => ForearmShape.HalfHeight(x) * 0.45f,
                          x => ForearmShape.CenterY(x) + ForearmShape.HalfHeight(x) * 0.42f, x => armZ, 0.25f));
                Part(g, BodyLayer.Muscle, "Quadriceps" + side, c, 1f,
                    LoftX(-0.40f, -0.02f, 12, 12, x => Mathf.Lerp(0.040f, 0.062f, (x + 0.40f) / 0.38f), x => 0.034f,
                          x => T + Mathf.Lerp(0.050f, 0.082f, (x + 0.40f) / 0.38f) + 0.02f, x => legZ, 0.25f));
                Part(g, BodyLayer.Muscle, "Sartorius" + side, c, 1f,
                    Tube(new[] { new Vector3(0.03f, T + 0.16f, MidZ + s * 0.14f), new Vector3(-0.18f, T + 0.15f, legZ), new Vector3(-0.40f, T + 0.10f, legZ - s * 0.035f) }, u => 0.011f, 6, 6));
                Part(g, BodyLayer.Muscle, "Tibialis anterior" + side, c, 1f,
                    LoftX(-0.80f, -0.46f, 10, 8, x => 0.017f, x => 0.016f, x => T + Profile(x, new[] { -0.80f, -0.56f, -0.46f }, new[] { 0.055f, 0.088f, 0.090f }), x => legZ + s * 0.018f, 0.3f));
                Part(g, BodyLayer.Muscle, "Gastrocnemius" + side, c, 1f,
                    LoftX(-0.68f, -0.44f, 10, 10, x => 0.038f, x => 0.026f, x => T + 0.028f, x => legZ, 0.4f));
            }
        }

        // =====================================================================================================
        // Skeleton
        // =====================================================================================================

        static void BuildSkeleton(Transform g)
        {
            Color c = BoneColor;
            // Skull, jaw, eye sockets.
            Part(g, BodyLayer.Skeleton, "Skull", c, 1f,
                Ellipsoid(new Vector3(0.758f, T + 0.098f, MidZ), new Vector3(0.100f, 0.084f, 0.070f), Quaternion.identity, 18, 12));
            Part(g, BodyLayer.Skeleton, "Mandible", c, 1f,
                Tube(new[] { new Vector3(0.715f, T + 0.07f, MidZ - 0.058f), new Vector3(0.672f, T + 0.15f, MidZ - 0.035f), new Vector3(0.655f, T + 0.168f, MidZ),
                             new Vector3(0.672f, T + 0.15f, MidZ + 0.035f), new Vector3(0.715f, T + 0.07f, MidZ + 0.058f) }, u => 0.010f, 4, 6));
            for (int s = -1; s <= 1; s += 2)
            {
                Vector3 orbit = new Vector3(0.735f, T + 0.178f, MidZ + s * 0.032f);
                Part(g, BodyLayer.Skeleton, s > 0 ? "Orbit (right)" : "Orbit (left)", c, 1f,
                    Tube(LineBuilder.Circle(orbit, Vector3.up, 0.018f, 14), u => 0.004f, 1, 5));
            }

            // Spine: 7 cervical, 12 thoracic, 5 lumbar, sacrum.
            List<Mesh> vertebrae = new List<Mesh>();
            for (int i = 0; i < 24; i++)
            {
                float x = Mathf.Lerp(0.665f, 0.105f, i / 23f);
                float size = i < 7 ? 0.7f : (i < 19 ? 1f : 1.3f);
                float y = i < 7 ? T + 0.055f : T + 0.040f;
                vertebrae.Add(Ellipsoid(new Vector3(x, y, MidZ), new Vector3(0.010f, 0.016f, 0.022f) * size, Quaternion.identity, 8, 6));
            }
            Part(g, BodyLayer.Skeleton, "Spine (vertebral column)", c, 1f, Combine(vertebrae));
            Part(g, BodyLayer.Skeleton, "Sacrum", c, 1f,
                Ellipsoid(new Vector3(0.045f, T + 0.040f, MidZ), new Vector3(0.050f, 0.020f, 0.045f), Quaternion.identity, 10, 8));

            // Ribs: 12 pairs around the torso cross-section, sloping down toward the front.
            for (int s = -1; s <= 1; s += 2)
            {
                List<Mesh> ribs = new List<Mesh>();
                for (int i = 0; i < 12; i++)
                {
                    float xBack = 0.515f - i * 0.021f;
                    float thetaEnd = i < 7 ? 2.85f : (i < 10 ? 2.55f : 1.7f);
                    List<Vector3> pts = new List<Vector3>();
                    for (int k = 0; k <= 8; k++)
                    {
                        float th = Mathf.Lerp(0.22f, thetaEnd, k / 8f);
                        float x = Mathf.Lerp(xBack, xBack - 0.055f, th / Mathf.PI);
                        float w = TorsoHalfW(x) * 0.90f, h = TorsoHalfH(x) * 0.86f;
                        pts.Add(new Vector3(x, TorsoCY(x) - h * Mathf.Cos(th), MidZ + s * w * Mathf.Sin(th)));
                    }
                    ribs.Add(Tube(pts, u => 0.0048f, 3, 5));
                }
                Part(g, BodyLayer.Skeleton, s > 0 ? "Ribs (right)" : "Ribs (left)", c, 1f, Combine(ribs));
            }
            Part(g, BodyLayer.Skeleton, "Sternum", c, 1f,
                LoftX(0.33f, 0.535f, 8, 8, x => 0.017f, x => 0.006f, x => TorsoTop(x) - 0.014f, x => MidZ, 0.15f));

            for (int s = -1; s <= 1; s += 2)
            {
                string side = s > 0 ? " (right)" : " (left)";
                float armZ = MidZ + s * ArmDz;
                float legZ = MidZ + s * 0.09f;

                Part(g, BodyLayer.Skeleton, "Clavicle" + side, c, 1f,
                    Tube(new[] { new Vector3(0.535f, TorsoTop(0.535f) - 0.012f, MidZ + s * 0.022f), new Vector3(0.548f, TorsoTop(0.548f) - 0.02f, MidZ + s * 0.10f),
                                 new Vector3(0.556f, T + 0.11f, MidZ + s * 0.18f) }, u => 0.0075f, 4, 6));
                Part(g, BodyLayer.Skeleton, "Scapula" + side, c, 1f,
                    Ellipsoid(new Vector3(0.47f, T + 0.026f, MidZ + s * 0.105f), new Vector3(0.078f, 0.008f, 0.056f), Quaternion.Euler(0f, s * 12f, 0f), 10, 6));
                Part(g, BodyLayer.Skeleton, "Humerus" + side, c, 1f,
                    LoftX(0.27f, 0.555f, 12, 8, x => Knob(x, 0.27f, 0.555f, 0.011f, 0.022f), x => Knob(x, 0.27f, 0.555f, 0.011f, 0.021f),
                          x => T + 0.040f, x => MidZ + s * Mathf.Lerp(0.238f, 0.205f, (x - 0.27f) / 0.285f), 0.08f));
                Part(g, BodyLayer.Skeleton, "Radius" + side, c, 1f,
                    LoftX(0.012f, 0.255f, 12, 6, x => Knob(x, 0.012f, 0.255f, 0.0065f, 0.012f), x => Knob(x, 0.012f, 0.255f, 0.0065f, 0.010f),
                          x => ForearmShape.CenterY(x), x => armZ + s * 0.012f, 0.06f));
                Part(g, BodyLayer.Skeleton, "Ulna" + side, c, 1f,
                    LoftX(0.008f, 0.27f, 12, 6, x => Knob(x, 0.008f, 0.27f, 0.006f, 0.011f), x => Knob(x, 0.008f, 0.27f, 0.006f, 0.010f),
                          x => ForearmShape.CenterY(x) - 0.004f, x => armZ - s * 0.013f, 0.06f));

                // Hand: carpals, five metacarpals + fingers fanned out, thumb on the outer (radial) side.
                List<Mesh> hand = new List<Mesh>();
                hand.Add(Ellipsoid(new Vector3(-0.012f, T + 0.018f, armZ), new Vector3(0.016f, 0.008f, 0.026f), Quaternion.identity, 8, 6));
                for (int f = 0; f < 5; f++)
                {
                    float dz = (f - 2) * 0.012f;   // f = 4 is the thumb side
                    bool thumb = f == 4;
                    Vector3 a = new Vector3(-0.03f, T + 0.018f, armZ + s * (dz * 0.6f));
                    Vector3 b = thumb ? new Vector3(-0.07f, T + 0.020f, armZ + s * 0.045f) : new Vector3(-0.10f, T + 0.018f, armZ + s * dz);
                    Vector3 tip = thumb ? new Vector3(-0.11f, T + 0.022f, armZ + s * 0.058f)
                                        : new Vector3(-0.10f - (f == 2 ? 0.09f : (f == 0 ? 0.065f : 0.08f)), T + 0.016f, armZ + s * dz * 1.15f);
                    hand.Add(Tube(new[] { a, b, tip }, u => Mathf.Lerp(0.0045f, 0.0032f, u), 3, 5));
                }
                Part(g, BodyLayer.Skeleton, "Hand bones" + side, c, 1f, Combine(hand));

                // Pelvis: iliac wing on each side + half of the pelvic ring.
                Part(g, BodyLayer.Skeleton, "Ilium" + side, c, 1f,
                    Ellipsoid(new Vector3(0.085f, T + 0.085f, MidZ + s * 0.105f), new Vector3(0.060f, 0.050f, 0.020f), Quaternion.Euler(s * -35f, 0f, 0f), 12, 8));
                Part(g, BodyLayer.Skeleton, "Pubis / ischium" + side, c, 1f,
                    Tube(new[] { new Vector3(0.06f, T + 0.11f, MidZ + s * 0.12f), new Vector3(0.0f, T + 0.13f, MidZ + s * 0.065f), new Vector3(-0.012f, T + 0.135f, MidZ + s * 0.004f) }, u => 0.011f, 4, 6));

                Part(g, BodyLayer.Skeleton, "Femur" + side, c, 1f,
                    LoftX(-0.425f, 0.0f, 14, 8, x => Knob(x, -0.425f, 0.0f, 0.013f, 0.025f), x => Knob(x, -0.425f, 0.0f, 0.013f, 0.024f),
                          x => T + 0.060f, x => legZ, 0.06f));
                Part(g, BodyLayer.Skeleton, "Femoral head" + side, c, 1f,
                    Ellipsoid(new Vector3(0.025f, T + 0.075f, MidZ + s * 0.075f), Vector3.one * 0.022f, Quaternion.identity, 10, 8));
                Part(g, BodyLayer.Skeleton, "Patella" + side, c, 1f,
                    Ellipsoid(new Vector3(-0.425f, T + 0.098f, legZ), new Vector3(0.022f, 0.009f, 0.020f), Quaternion.identity, 8, 6));
                Part(g, BodyLayer.Skeleton, "Tibia" + side, c, 1f,
                    LoftX(-0.825f, -0.44f, 12, 8, x => Knob(x, -0.825f, -0.44f, 0.012f, 0.024f), x => Knob(x, -0.825f, -0.44f, 0.012f, 0.022f),
                          x => T + 0.055f, x => legZ - s * 0.005f, 0.06f));
                Part(g, BodyLayer.Skeleton, "Fibula" + side, c, 1f,
                    LoftX(-0.83f, -0.46f, 10, 6, x => 0.0055f, x => 0.0055f, x => T + 0.040f, x => legZ + s * 0.028f, 0.05f));

                List<Mesh> foot = new List<Mesh>();
                foot.Add(Ellipsoid(new Vector3(-0.875f, T + 0.035f, legZ), new Vector3(0.028f, 0.030f, 0.022f), Quaternion.identity, 8, 6));
                for (int f = 0; f < 5; f++)
                {
                    float dz = (f - 2) * 0.011f;
                    foot.Add(Tube(new[] { new Vector3(-0.880f, T + 0.07f, legZ + s * dz * 0.5f), new Vector3(-0.885f, T + 0.15f, legZ + s * dz), new Vector3(-0.88f, T + 0.195f, legZ + s * dz * 1.2f) },
                                  u => Mathf.Lerp(0.0055f, 0.0035f, u), 3, 5));
                }
                Part(g, BodyLayer.Skeleton, "Foot bones" + side, c, 1f, Combine(foot));
            }
        }

        // =====================================================================================================
        // Organs
        // =====================================================================================================

        static void BuildOrgans(Transform g)
        {
            Part(g, BodyLayer.Organ, "Brain", Palette.Hex(0xFFB8E0), 1f,
                Ellipsoid(new Vector3(0.768f, T + 0.104f, MidZ), new Vector3(0.082f, 0.064f, 0.060f), Quaternion.identity, 16, 12));
            Part(g, BodyLayer.Organ, "Right lung", Palette.Hex(0xFF9EC4), 0.9f,
                Ellipsoid(new Vector3(0.43f, TorsoCY(0.43f) + 0.01f, MidZ + 0.078f), new Vector3(0.100f, 0.068f, 0.060f), Quaternion.identity, 14, 10));
            Part(g, BodyLayer.Organ, "Left lung", Palette.Hex(0xFF9EC4), 0.9f,
                Ellipsoid(new Vector3(0.44f, TorsoCY(0.44f) + 0.01f, MidZ - 0.085f), new Vector3(0.092f, 0.064f, 0.052f), Quaternion.identity, 14, 10));
            Part(g, BodyLayer.Organ, "Heart", Palette.Red, 1.2f,
                Ellipsoid(new Vector3(0.405f, TorsoCY(0.405f) + 0.025f, MidZ - 0.025f), new Vector3(0.055f, 0.045f, 0.042f), Quaternion.Euler(0f, -30f, 0f), 14, 10));
            Part(g, BodyLayer.Organ, "Liver", Palette.Hex(0xFFA24D), 1f,
                Ellipsoid(new Vector3(0.305f, TorsoCY(0.305f) + 0.01f, MidZ + 0.055f), new Vector3(0.068f, 0.050f, 0.100f), Quaternion.Euler(0f, 10f, 0f), 14, 10));
            Part(g, BodyLayer.Organ, "Stomach", Palette.Hex(0xFFC878), 1f,
                Ellipsoid(new Vector3(0.29f, TorsoCY(0.29f) + 0.015f, MidZ - 0.075f), new Vector3(0.058f, 0.038f, 0.048f), Quaternion.Euler(0f, 25f, 0f), 12, 8));
            Part(g, BodyLayer.Organ, "Spleen", Palette.Hex(0xD07CFF), 1f,
                Ellipsoid(new Vector3(0.31f, TorsoCY(0.31f) - 0.03f, MidZ - 0.13f), new Vector3(0.040f, 0.024f, 0.024f), Quaternion.identity, 10, 8));
            Part(g, BodyLayer.Organ, "Pancreas", Palette.Yellow, 0.9f,
                Tube(new[] { new Vector3(0.26f, TorsoCY(0.26f) - 0.01f, MidZ + 0.035f), new Vector3(0.27f, TorsoCY(0.27f), MidZ - 0.04f), new Vector3(0.285f, TorsoCY(0.285f) - 0.01f, MidZ - 0.11f) }, u => Mathf.Lerp(0.013f, 0.008f, u), 6, 8));
            for (int s = -1; s <= 1; s += 2)
            {
                Part(g, BodyLayer.Organ, s > 0 ? "Right kidney" : "Left kidney", Palette.Hex(0xFF7F50), 1f,
                    Ellipsoid(new Vector3(0.235f + (s > 0 ? -0.01f : 0f), T + 0.055f, MidZ + s * 0.075f), new Vector3(0.045f, 0.020f, 0.026f), Quaternion.identity, 10, 8));
            }

            // Large intestine: ascending (right), transverse, descending (left), sigmoid.
            Part(g, BodyLayer.Organ, "Large intestine", Palette.Hex(0xE6B3FF), 0.9f,
                Tube(new[] { new Vector3(0.08f, TorsoCY(0.08f) + 0.01f, MidZ + 0.105f), new Vector3(0.21f, TorsoCY(0.21f) + 0.01f, MidZ + 0.105f),
                             new Vector3(0.235f, TorsoCY(0.235f) + 0.03f, MidZ), new Vector3(0.215f, TorsoCY(0.215f) + 0.01f, MidZ - 0.11f),
                             new Vector3(0.08f, TorsoCY(0.08f) + 0.01f, MidZ - 0.11f), new Vector3(0.035f, TorsoCY(0.035f) + 0.01f, MidZ - 0.03f) }, u => 0.019f, 8, 8));

            // Small intestine: a winding loop filling the middle of the abdomen.
            List<Vector3> coil = new List<Vector3>();
            for (int row = 0; row < 6; row++)
            {
                float x = Mathf.Lerp(0.185f, 0.075f, row / 5f);
                for (int k = 0; k <= 6; k++)
                {
                    float t = (row % 2 == 0) ? k / 6f : 1f - k / 6f;
                    float z = MidZ + Mathf.Lerp(-0.075f, 0.075f, t);
                    coil.Add(new Vector3(x + 0.008f * Mathf.Sin(k * 1.7f), TorsoCY(x) + 0.03f + 0.006f * Mathf.Cos(k * 2.1f), z));
                }
            }
            Part(g, BodyLayer.Organ, "Small intestine", Palette.Hex(0xFFCF9E), 0.85f, Tube(coil, u => 0.011f, 3, 6));
            Part(g, BodyLayer.Organ, "Bladder", Palette.Hex(0x9FC5FF), 1f,
                Ellipsoid(new Vector3(0.025f, T + 0.105f, MidZ), new Vector3(0.030f, 0.028f, 0.034f), Quaternion.identity, 10, 8));
        }

        // A thin amber dashed loop on the skin around the surgical window (never green, never filled).
        static void BuildWindowOutline(Transform root)
        {
            List<Vector3> pts = new List<Vector3>();
            float cx = 0.5f * (WindowX0 + WindowX1), ax = 0.5f * (WindowX1 - WindowX0) + 0.004f;
            for (int i = 0; i < 40; i++)
            {
                float a = i / 40f * Mathf.PI * 2f;
                float x = cx + ax * Mathf.Cos(a);
                float z = (WindowHalfZ + 0.003f) * Mathf.Sin(a);
                pts.Add(new Vector3(x, ForearmShape.SurfaceY(x, z) + 0.0015f, z));
            }
            _windowMat = HoloMaterials.Dashed(Palette.Amber, 20f, 0.9f);
            LineBuilder.Polyline(root, "Surgical window outline", pts, _windowMat, 0.0016f, true);
        }

        // =====================================================================================================
        // Mesh helpers
        // =====================================================================================================

        static Transform Group(string name)
        {
            GameObject go = new GameObject(name);
            go.transform.SetParent(_model.Root, false);
            return go.transform;
        }

        static void Part(Transform group, BodyLayer layer, string displayName, Color color, float intensity, Mesh mesh)
        {
            CutWindow(mesh);
            if (mesh.triangles.Length < 3) return;
            GameObject go = new GameObject(displayName);
            go.transform.SetParent(group, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            MeshRenderer r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = layer == BodyLayer.Skin ? _skinMat : layer == BodyLayer.Muscle ? _muscleMat : layer == BodyLayer.Skeleton ? _boneMat : _organMat;
            r.shadowCastingMode = ShadowCastingMode.Off;
            r.receiveShadows = false;
            r.lightProbeUsage = LightProbeUsage.Off;
            r.reflectionProbeUsage = ReflectionProbeUsage.Off;
            BodyPart part = go.AddComponent<BodyPart>();
            part.Init(layer, displayName, color, intensity);
            _model.Parts.Add(part);
            _model.Triangles += mesh.triangles.Length / 3;
        }

        // Drops every triangle whose centre lies in the surgical window (any depth), so the real arm shows through.
        static void CutWindow(Mesh mesh)
        {
            Bounds b = mesh.bounds;
            if (b.max.x < WindowX0 || b.min.x > WindowX1 || b.max.z < -WindowHalfZ || b.min.z > WindowHalfZ) return;
            Vector3[] v = mesh.vertices;
            int[] tris = mesh.triangles;
            List<int> kept = new List<int>(tris.Length);
            float hz = WindowHalfZ, cx = 0.5f * (WindowX0 + WindowX1), ax = 0.5f * (WindowX1 - WindowX0);
            for (int i = 0; i < tris.Length; i += 3)
            {
                Vector3 c = (v[tris[i]] + v[tris[i + 1]] + v[tris[i + 2]]) / 3f;
                float ex = (c.x - cx) / ax, ez = c.z / hz;
                bool inWindow = ex * ex + ez * ez < 1f && c.y > T - 0.01f;
                if (!inWindow) { kept.Add(tris[i]); kept.Add(tris[i + 1]); kept.Add(tris[i + 2]); }
            }
            if (kept.Count != tris.Length) mesh.SetTriangles(kept, 0);
        }

        /// <summary>Piecewise-linear profile through (xs[i], ys[i]); clamped at the ends.</summary>
        static float Profile(float x, float[] xs, float[] ys)
        {
            if (x <= xs[0]) return ys[0];
            for (int i = 1; i < xs.Length; i++)
            {
                if (x <= xs[i]) return Mathf.Lerp(ys[i - 1], ys[i], Mathf.SmoothStep(0f, 1f, (x - xs[i - 1]) / (xs[i] - xs[i - 1])));
            }
            return ys[ys.Length - 1];
        }

        /// <summary>A long bone's radius: thin shaft, wider at both ends.</summary>
        static float Knob(float x, float x0, float x1, float shaft, float end)
        {
            float u = Mathf.Clamp01((x - x0) / (x1 - x0));
            float d = Mathf.Min(u, 1f - u);
            return Mathf.Lerp(end, shaft, Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(d / 0.18f)));
        }

        /// <summary>
        /// A closed shape lofted along X with elliptical cross-sections. capFraction rounds the ends over that
        /// fraction of the length on each side (0.5 makes an ellipsoid).
        /// </summary>
        static Mesh LoftX(float x0, float x1, int rings, int sides, Func<float, float> halfW, Func<float, float> halfH,
            Func<float, float> centerY, Func<float, float> centerZ, float capFraction)
        {
            List<Vector3> verts = new List<Vector3>();
            List<int> tris = new List<int>();
            rings = Mathf.Max(rings, 2);
            for (int i = 0; i <= rings; i++)
            {
                // Cosine spacing: rings bunch up at the ends, so rounded caps stay round instead of coming to a point.
                float u = capFraction > 0f ? 0.5f - 0.5f * Mathf.Cos(Mathf.PI * i / rings) : i / (float)rings;
                float x = Mathf.Lerp(x0, x1, u);
                float s = 1f;
                if (capFraction > 0f)
                {
                    float d = Mathf.Min(u, 1f - u);
                    if (d < capFraction) { float e = (capFraction - d) / capFraction; s = Mathf.Sqrt(Mathf.Max(0f, 1f - e * e)); }
                }
                float w = halfW(x) * s, h = halfH(x) * s, cy = centerY(x), cz = centerZ(x);
                for (int k = 0; k <= sides; k++)
                {
                    float a = k / (float)sides * Mathf.PI * 2f;
                    verts.Add(new Vector3(x, cy + h * Mathf.Cos(a), cz + w * Mathf.Sin(a)));
                }
            }
            int rv = sides + 1;
            for (int i = 0; i < rings; i++)
            {
                for (int k = 0; k < sides; k++)
                {
                    int a = i * rv + k, b = a + rv;
                    tris.Add(a); tris.Add(a + 1); tris.Add(b);
                    tris.Add(b); tris.Add(a + 1); tris.Add(b + 1);
                }
            }
            return Finish(verts, tris, "Loft", false);
        }

        static Mesh Ellipsoid(Vector3 center, Vector3 radii, Quaternion rotation, int segments, int stacks)
        {
            List<Vector3> verts = new List<Vector3>();
            List<int> tris = new List<int>();
            for (int i = 0; i <= stacks; i++)
            {
                float phi = i / (float)stacks * Mathf.PI;
                for (int k = 0; k <= segments; k++)
                {
                    float th = k / (float)segments * Mathf.PI * 2f;
                    Vector3 p = new Vector3(Mathf.Cos(phi) * radii.x, Mathf.Sin(phi) * Mathf.Cos(th) * radii.y, Mathf.Sin(phi) * Mathf.Sin(th) * radii.z);
                    verts.Add(center + rotation * p);
                }
            }
            int rv = segments + 1;
            for (int i = 0; i < stacks; i++)
            {
                for (int k = 0; k < segments; k++)
                {
                    int a = i * rv + k, b = a + rv;
                    tris.Add(a); tris.Add(a + 1); tris.Add(b);
                    tris.Add(b); tris.Add(a + 1); tris.Add(b + 1);
                }
            }
            return Finish(verts, tris, "Ellipsoid", true);
        }

        static Mesh Tube(IList<Vector3> controlPoints, Func<float, float> radiusAt, int samplesPerSegment, int sides)
        {
            Mesh m = TubeBuilder.BuildMesh(TubeBuilder.CatmullRom(controlPoints, samplesPerSegment), radiusAt, sides);
            Color[] colors = new Color[m.vertexCount];
            for (int i = 0; i < colors.Length; i++) colors[i] = Color.white;
            m.colors = colors;
            return m;
        }

        static Mesh Combine(List<Mesh> meshes)
        {
            CombineInstance[] ci = new CombineInstance[meshes.Count];
            for (int i = 0; i < meshes.Count; i++) { ci[i].mesh = meshes[i]; ci[i].transform = Matrix4x4.identity; }
            Mesh m = new Mesh();
            m.name = "Combined";
            m.CombineMeshes(ci, true, true);
            return m;
        }

        static Mesh Finish(List<Vector3> verts, List<int> tris, string name, bool flip)
        {
            // Outsides must be front faces (back faces are culled). The ellipsoid is generated inside-out: flip it.
            if (flip) for (int i = 0; i < tris.Count; i += 3) { int t = tris[i + 1]; tris[i + 1] = tris[i + 2]; tris[i + 2] = t; }
            Mesh m = new Mesh();
            m.name = name;
            if (verts.Count > 65000) m.indexFormat = IndexFormat.UInt32;
            m.SetVertices(verts);
            m.SetTriangles(tris, 0);
            Color[] colors = new Color[verts.Count];
            for (int i = 0; i < colors.Length; i++) colors[i] = Color.white;
            m.colors = colors;
            m.RecalculateNormals();
            m.RecalculateBounds();
            return m;
        }
    }
}
