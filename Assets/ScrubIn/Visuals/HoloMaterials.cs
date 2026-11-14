using UnityEngine;

namespace ScrubIn
{
    /// <summary>Property ids of the ScrubIn/HoloGlow shader.</summary>
    public static class HoloProps
    {
        public static readonly int Color = Shader.PropertyToID("_Color");
        public static readonly int Intensity = Shader.PropertyToID("_Intensity");
        public static readonly int Alpha = Shader.PropertyToID("_Alpha");
        public static readonly int Fill = Shader.PropertyToID("_Fill");
        public static readonly int RimStrength = Shader.PropertyToID("_RimStrength");
        public static readonly int RimPower = Shader.PropertyToID("_RimPower");
        public static readonly int Shape = Shader.PropertyToID("_Shape");
        public static readonly int Soft = Shader.PropertyToID("_Soft");
        public static readonly int PulseSpeed = Shader.PropertyToID("_PulseSpeed");
        public static readonly int PulseAmount = Shader.PropertyToID("_PulseAmount");
        public static readonly int PulsePhase = Shader.PropertyToID("_PulsePhase");
        public static readonly int Draw = Shader.PropertyToID("_Draw");
        public static readonly int DrawHead = Shader.PropertyToID("_DrawHead");
        public static readonly int Dash = Shader.PropertyToID("_Dash");
        public static readonly int FlowSpeed = Shader.PropertyToID("_FlowSpeed");
        public static readonly int FlowCount = Shader.PropertyToID("_FlowCount");
        public static readonly int FlowStrength = Shader.PropertyToID("_FlowStrength");
        public static readonly int RevealOn = Shader.PropertyToID("_RevealOn");
        public static readonly int RevealAxis = Shader.PropertyToID("_RevealAxis");
        public static readonly int RevealPos = Shader.PropertyToID("_RevealPos");
        public static readonly int RevealBand = Shader.PropertyToID("_RevealBand");
        public static readonly int RevealGlow = Shader.PropertyToID("_RevealGlow");
        public static readonly int Cull = Shader.PropertyToID("_Cull");
        public static readonly int ZTest = Shader.PropertyToID("_ZTest");

        /// <summary>Global, 0..1. 0 = everything visible, 1 = every hologram faded out.</summary>
        public static readonly int GlobalDim = Shader.PropertyToID("_ScrubInGlobalDim");
    }

    /// <summary>
    /// Makes materials on the ScrubIn/HoloGlow shader. Create one material per look and share it between
    /// renderers; per-object fades and trace-on animation go through HoloElement, not through the material.
    /// </summary>
    public static class HoloMaterials
    {
        public const string ShaderName = "ScrubIn/HoloGlow";

        static Shader _shader;
        static bool _fallback;

        /// <summary>True if HoloGlow could not be used and a plain built-in additive shader is standing in.</summary>
        public static bool UsingFallback { get { return _fallback; } }

        public static Shader GlowShader
        {
            get
            {
                if (_shader != null) return _shader;

                Shader shader = Shader.Find(ShaderName);
                if (shader == null || !shader.isSupported)
                {
                    ScrubInLog.Warn(ShaderName + (shader == null ? " shader was not found" : " shader failed to compile")
                                    + ". Holograms are using a plain fallback shader; copy the shader error from the Console to Kartik's agent.");
                    _fallback = true;
                    shader = Shader.Find("Legacy Shaders/Particles/Additive");
                    if (shader == null) shader = Shader.Find("Sprites/Default");
                }

                _shader = shader;
                return _shader;
            }
        }

        /// <summary>Forget cached lookups. The bootstrap calls this at the start of every run.</summary>
        public static void ResetCache()
        {
            _shader = null;
            _fallback = false;
        }

        /// <summary>A thin glowing line (LineBuilder.Polyline). Soft edges, bright core.</summary>
        public static Material Line(Color color, float intensity = 1f)
        {
            Material m = Make("HoloLine", color, intensity);
            m.SetFloat(HoloProps.Shape, 1f);
            return m;
        }

        /// <summary>A dashed glowing line with <c>dashes</c> dashes along its length.</summary>
        public static Material Dashed(Color color, float dashes, float intensity = 1f)
        {
            Material m = Line(color, intensity);
            m.name = "HoloDashed";
            m.SetFloat(HoloProps.Dash, dashes);
            return m;
        }

        /// <summary>
        /// For tubes and meshes: a faint fill plus a fresnel rim, so the edges glow and the middle stays
        /// see-through. Keep <c>fill</c> low; bright filled areas wash out the real arm.
        /// </summary>
        public static Material Solid(Color color, float intensity = 1f, float fill = 0.12f, float rim = 1.2f)
        {
            Material m = Make("HoloSolid", color, intensity);
            m.SetFloat(HoloProps.Shape, 0f);
            m.SetFloat(HoloProps.Fill, fill);
            m.SetFloat(HoloProps.RimStrength, rim);
            m.SetFloat(HoloProps.Cull, 2f);   // back faces off, or both sides add up
            return m;
        }

        /// <summary>A soft glowing dot (LineBuilder.Dot / Quad).</summary>
        public static Material Disc(Color color, float intensity = 1f)
        {
            Material m = Make("HoloDisc", color, intensity);
            m.SetFloat(HoloProps.Shape, 2f);
            return m;
        }

        /// <summary>A thin glowing circle (LineBuilder.Dot / Quad).</summary>
        public static Material Ring(Color color, float intensity = 1f)
        {
            Material m = Make("HoloRing", color, intensity);
            m.SetFloat(HoloProps.Shape, 3f);
            return m;
        }

        /// <summary>Brightness dips by <c>amount</c> (0..1), <c>hz</c> times a second.</summary>
        public static void SetPulse(Material m, float hz, float amount, float phase = 0f)
        {
            m.SetFloat(HoloProps.PulseSpeed, hz);
            m.SetFloat(HoloProps.PulseAmount, amount);
            m.SetFloat(HoloProps.PulsePhase, phase);
        }

        /// <summary>Bright bands travelling along U (the length of a tube or line), e.g. blood flow.</summary>
        public static void SetFlow(Material m, float cyclesPerSecond, float bandCount, float strength)
        {
            m.SetFloat(HoloProps.FlowSpeed, cyclesPerSecond);
            m.SetFloat(HoloProps.FlowCount, bandCount);
            m.SetFloat(HoloProps.FlowStrength, strength);
        }

        /// <summary>
        /// Turns on the reveal wipe. Only fragments whose patient-space position p has dot(p, axis) below
        /// <c>position</c> are drawn, with a glowing band at the front. Animate HoloProps.RevealPos to wipe.
        /// </summary>
        public static void SetReveal(Material m, Vector3 axisPatient, float position, float band = 0.012f, float glow = 3f)
        {
            m.SetFloat(HoloProps.RevealOn, 1f);
            m.SetVector(HoloProps.RevealAxis, axisPatient.normalized);
            m.SetFloat(HoloProps.RevealPos, position);
            m.SetFloat(HoloProps.RevealBand, band);
            m.SetFloat(HoloProps.RevealGlow, glow);
        }

        public static void ClearReveal(Material m)
        {
            m.SetFloat(HoloProps.RevealOn, 0f);
        }

        static Material Make(string name, Color color, float intensity)
        {
            Shader shader = GlowShader;
            if (shader == null)
            {
                throw new System.InvalidOperationException("No usable shader for holograms: " + ShaderName
                                                           + " is missing and so are the built-in fallbacks.");
            }

            Material m = new Material(shader);
            m.name = name;
            m.SetColor(HoloProps.Color, color);
            m.SetFloat(HoloProps.Intensity, intensity);
            m.renderQueue = 3000;
            if (_fallback)
            {
                // The legacy additive particle shader takes its colour from _TintColor at half strength.
                m.SetColor("_TintColor", new Color(color.r, color.g, color.b, 0.5f) * Mathf.Min(intensity, 1f));
            }
            return m;
        }
    }
}
