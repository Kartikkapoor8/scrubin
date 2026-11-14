using UnityEngine;

namespace ScrubIn
{
    /// <summary>The ScrubIn colours. Use these; don't invent new ones.</summary>
    public static class Palette
    {
        /// <summary>#3FE0FF. Primary: outlines, UI lines, most text accents.</summary>
        public static readonly Color Cyan = Hex(0x3FE0FF);

        /// <summary>Text.</summary>
        public static readonly Color White = Color.white;

        /// <summary>#4DFFB0. Success: completed sutures, check marks.</summary>
        public static readonly Color Green = Hex(0x4DFFB0);

        /// <summary>#FFB547. Attention: the wound, the current target.</summary>
        public static readonly Color Amber = Hex(0xFFB547);

        /// <summary>#FF4D5E. Danger and arteries.</summary>
        public static readonly Color Red = Hex(0xFF4D5E);

        /// <summary>#4D8BFF. Veins.</summary>
        public static readonly Color Blue = Hex(0x4D8BFF);

        /// <summary>#FFE14D. Nerve.</summary>
        public static readonly Color Yellow = Hex(0xFFE14D);

        /// <summary>#E8F0FF. Bone and tendon; use at low intensity.</summary>
        public static readonly Color Bone = Hex(0xE8F0FF);

        public static Color Hex(int rgb)
        {
            return new Color(((rgb >> 16) & 0xFF) / 255f, ((rgb >> 8) & 0xFF) / 255f, (rgb & 0xFF) / 255f, 1f);
        }

        public static Color WithAlpha(Color c, float alpha)
        {
            return new Color(c.r, c.g, c.b, alpha);
        }
    }
}
