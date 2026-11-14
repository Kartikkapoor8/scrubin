using TMPro;
using UnityEngine;

namespace ScrubIn
{
    /// <summary>
    /// Text labels for holograms (TextMeshPro), sized by cap height in meters and turned toward the viewer,
    /// with an optional leader line to the thing they name.
    ///
    ///     LabelBuilder.Create(group, "Radial artery", new Vector3(0.08f, 0.03f, 0.05f), 0.010f, Palette.White)
    ///                 .WithLeader(arteryPoint, Palette.Red);
    ///
    /// Keep capitals at least 0.010 m (1 cm) tall for text read from 0.7 m. White or cyan text.
    /// </summary>
    public static class LabelBuilder
    {
        // Cap height of the default TMP font (Liberation Sans) as a fraction of its em size.
        const float CapHeightPerEm = 0.69f;

        static bool _checked;
        static bool _available;

        /// <summary>
        /// False until the "TMP Essential Resources" are imported into the project (menu ScrubIn > Setup
        /// Project does it). Without them TextMeshPro has no font, so labels are created without text rather
        /// than letting TMP throw or open its import window in the middle of a run.
        /// </summary>
        public static bool TextAvailable
        {
            get
            {
                if (!_checked)
                {
                    _checked = true;
                    _available = Resources.Load<TMP_Settings>("TMP Settings") != null;
                    if (!_available)
                    {
                        ScrubInLog.Warn("TextMeshPro essentials are not imported, so labels are hidden. "
                                        + "Run the menu ScrubIn > Setup Project, then press Play again.");
                    }
                }
                return _available;
            }
        }

        /// <summary>Forget cached lookups. The bootstrap calls this at the start of every run.</summary>
        public static void ResetCache()
        {
            _checked = false;
            _available = false;
        }

        /// <summary>
        /// A label at <c>localPosition</c> in the parent's space. <c>capHeight</c> is the height of a capital
        /// letter in meters. The label turns to face the viewer unless you set <c>billboard</c> to false.
        /// </summary>
        public static HoloLabel Create(Transform parent, string text, Vector3 localPosition, float capHeight,
            Color color, TextAlignmentOptions alignment = TextAlignmentOptions.Center, bool billboard = true)
        {
            GameObject go = new GameObject("Label " + text, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPosition;

            HoloLabel label = go.AddComponent<HoloLabel>();
            label.CapHeight = capHeight;

            if (TextAvailable)
            {
                TextMeshPro tmp = go.AddComponent<TextMeshPro>();
                // In world space a TMP font size of 10 makes one em exactly one unit tall, so the object's
                // scale is the em size in meters.
                tmp.fontSize = 10f;
                tmp.enableWordWrapping = false;
                tmp.richText = true;
                tmp.alignment = alignment;
                tmp.color = color;
                tmp.text = text;
                tmp.rectTransform.sizeDelta = new Vector2(24f, 2f);
                label.Text = tmp;
            }

            float em = capHeight / CapHeightPerEm;
            go.transform.localScale = new Vector3(em, em, em);

            if (billboard) go.AddComponent<FaceViewer>();
            return label;
        }
    }

    /// <summary>A label made by LabelBuilder.</summary>
    public class HoloLabel : MonoBehaviour
    {
        /// <summary>The TextMeshPro component, or null if TMP's resources are not in the project yet.</summary>
        public TextMeshPro Text { get; internal set; }

        /// <summary>The leader line, if WithLeader was called.</summary>
        public LineRenderer Leader { get; private set; }

        public float CapHeight { get; internal set; }

        public void SetText(string text)
        {
            if (Text != null) Text.text = text;
        }

        /// <summary>
        /// Adds a thin line from <c>anchorLocal</c> (the thing being named, in the label's parent space) to
        /// the label, with a dot on the anchor. Stops just short of the text.
        /// </summary>
        public HoloLabel WithLeader(Vector3 anchorLocal, Color color, float width = 0.0012f)
        {
            Transform parent = transform.parent;
            Vector3 labelPos = transform.localPosition;
            Vector3 toLabel = labelPos - anchorLocal;
            float distance = toLabel.magnitude;
            if (distance < 1e-5f) return this;

            // Leave a gap of about one line of text before the label.
            float gap = Mathf.Min(CapHeight * 1.6f, distance * 0.5f);
            Vector3 end = labelPos - toLabel / distance * gap;

            Material lineMaterial = HoloMaterials.Line(color, 0.8f);
            Leader = LineBuilder.Segment(parent, "Leader " + name, anchorLocal, end, lineMaterial, width);
            LineBuilder.Dot(parent, "Leader dot " + name, anchorLocal, HoloMaterials.Disc(color, 1f), width * 4f);
            return this;
        }
    }
}
