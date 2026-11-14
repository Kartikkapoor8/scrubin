// NOT part of the Unity project (it lives outside Assets/). Used only by tools/check-compile.sh when the real
// TextMeshPro assembly is not available: just enough of the TMPro API surface for ScrubIn's code to type-check.
// Every member here was checked against com.unity.textmeshpro 2.1.6 (Scripts/Runtime/TMP_Text.cs, TextMeshPro.cs,
// TMP_Settings.cs). If you use a TMP member that is not listed, verify it exists in TMP 2.x and add it here.
using UnityEngine;

namespace TMPro
{
    public enum TextAlignmentOptions
    {
        TopLeft = 257, Top = 258, TopRight = 260,
        Left = 513, Center = 514, Right = 516,
        BottomLeft = 1025, Bottom = 1026, BottomRight = 1028
    }

    [System.Flags]
    public enum FontStyles { Normal = 0, Bold = 1, Italic = 2, Underline = 4, LowerCase = 8, UpperCase = 16, SmallCaps = 32 }

    public enum TextOverflowModes { Overflow = 0, Ellipsis = 1, Masking = 2, Truncate = 3 }

    public class TMP_FontAsset : ScriptableObject { }

    public class TMP_Settings : ScriptableObject
    {
        public static TMP_Settings instance { get { return null; } }
        public static TMP_FontAsset defaultFontAsset { get { return null; } }
    }

    public abstract class TMP_Text : MonoBehaviour
    {
        public virtual string text { get; set; }
        public TMP_FontAsset font { get; set; }
        public virtual Color color { get; set; }
        public float alpha { get; set; }
        public float fontSize { get; set; }
        public FontStyles fontStyle { get; set; }
        public TextAlignmentOptions alignment { get; set; }
        public float characterSpacing { get; set; }
        public float lineSpacing { get; set; }
        public bool enableWordWrapping { get; set; }
        public TextOverflowModes overflowMode { get; set; }
        public bool richText { get; set; }
        public int maxVisibleCharacters { get; set; }
        public RectTransform rectTransform { get { return null; } }
        public Bounds bounds { get { return default(Bounds); } }
        public Bounds textBounds { get { return default(Bounds); } }
        public void SetText(string sourceText, bool syncTextInputBox = true) { }
        public virtual void ForceMeshUpdate(bool ignoreActiveState = false, bool forceTextReparsing = false) { }
    }

    public class TextMeshPro : TMP_Text
    {
        public int sortingOrder { get; set; }
        public int sortingLayerID { get; set; }
    }
}
