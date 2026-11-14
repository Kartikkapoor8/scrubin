using UnityEngine;

namespace ScrubIn
{
    /// <summary>
    /// The shape of the forearm in the patient frame (CLAUDE.md): X wrist (0) to elbow (0.26), Y up, Z toward
    /// the thumb, meters. The single source of truth for the outline, the sutures, the anatomy and the virtual
    /// arm; use it instead of hard-coding numbers.
    ///
    /// The arm is modelled lying on a table: an ellipse in cross-section, wider and thicker toward the elbow,
    /// with a flat underside. y = 0 is the skin at the wound centre, so the table is at TableY (about -0.05).
    /// </summary>
    public static class ForearmShape
    {
        public const float Length = 0.26f;

        const float WristHalfWidth = 0.0325f;    // 65 mm wide at the wrist
        const float ElbowHalfWidth = 0.0425f;    // 85 mm wide at the elbow
        const float WristHalfHeight = 0.020f;    // 40 mm thick at the wrist
        const float ElbowHalfHeight = 0.031f;    // 62 mm thick at the elbow

        /// <summary>x of the wound centre. The skin here is y = 0.</summary>
        public const float ReferenceX = 0.121f;

        /// <summary>Height of the table top (the arm's underside) in the patient frame.</summary>
        public static readonly float TableY = -2f * HalfHeight(ReferenceX);

        // 0 at the wrist, 1 at the elbow, eased so the arm widens mostly through the middle.
        static float Along(float x)
        {
            float s = Mathf.Clamp01(x / Length);
            return s * s * (3f - 2f * s);
        }

        /// <summary>Half the arm's width (along Z) at x.</summary>
        public static float HalfWidth(float x)
        {
            return Mathf.Lerp(WristHalfWidth, ElbowHalfWidth, Along(x));
        }

        /// <summary>Half the arm's thickness (along Y) at x.</summary>
        public static float HalfHeight(float x)
        {
            return Mathf.Lerp(WristHalfHeight, ElbowHalfHeight, Along(x));
        }

        /// <summary>Height of the arm's centre line at x.</summary>
        public static float CenterY(float x)
        {
            return TableY + HalfHeight(x);
        }

        /// <summary>Height of the skin on top of the arm (the volar surface) at x, z. Clamped at the arm's edge.</summary>
        public static float SurfaceY(float x, float z)
        {
            float t = Mathf.Clamp(z / HalfWidth(x), -1f, 1f);
            return CenterY(x) + HalfHeight(x) * Mathf.Sqrt(1f - t * t);
        }

        /// <summary>The point on the skin on top of the arm at x, z.</summary>
        public static Vector3 Surface(float x, float z)
        {
            return new Vector3(x, SurfaceY(x, z), z);
        }

        /// <summary>The outward skin normal at x, z (in the cross-section plane; the taper along x is ignored).</summary>
        public static Vector3 SurfaceNormal(float x, float z)
        {
            float a = HalfWidth(x);
            float b = HalfHeight(x);
            float t = Mathf.Clamp(z / a, -0.999f, 0.999f);
            float y = b * Mathf.Sqrt(1f - t * t);
            return new Vector3(0f, y / (b * b), (t * a) / (a * a)).normalized;
        }

        /// <summary>A point <c>depth</c> meters under the skin at x, z (measured along the skin normal).</summary>
        public static Vector3 Below(float x, float z, float depth)
        {
            return Surface(x, z) - SurfaceNormal(x, z) * depth;
        }

        /// <summary>
        /// A point on the cross-section outline at x. Angle 0 is the thumb-side edge (+Z), pi/2 the top
        /// (volar skin), pi the little-finger edge (-Z), 3pi/2 the underside on the table.
        /// </summary>
        public static Vector3 Ring(float x, float angleRad)
        {
            return new Vector3(x, CenterY(x) + HalfHeight(x) * Mathf.Sin(angleRad), HalfWidth(x) * Mathf.Cos(angleRad));
        }
    }
}
