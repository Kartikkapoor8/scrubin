using UnityEngine;

namespace ScrubIn
{
    public enum BodyLayer { Skin, Muscle, Skeleton, Organ }

    /// <summary>What the body shows. Voice: "skin", "muscles", "skeleton", "organs", "x-ray".</summary>
    public enum BodyMode { Skin, Muscles, Skeleton, Organs, XRay }

    /// <summary>
    /// One named, selectable piece of the body (a bone, an organ, a muscle, a patch of skin). Glow, hover and
    /// selection are per renderer through a MaterialPropertyBlock, so every part of a layer shares one material.
    /// </summary>
    public class BodyPart : MonoBehaviour
    {
        public BodyLayer Layer;
        public string DisplayName;
        public Color BaseColor;
        public float BaseIntensity = 1f;

        MeshRenderer _renderer;
        MeshCollider _collider;
        MaterialPropertyBlock _block;
        bool _visible = true;
        float _dim = 1f;
        bool _hover;
        bool _selected;

        public MeshRenderer Renderer { get { return _renderer; } }
        public bool Visible { get { return _visible; } }

        public void Init(BodyLayer layer, string displayName, Color color, float intensity)
        {
            Layer = layer;
            DisplayName = displayName;
            BaseColor = color;
            BaseIntensity = intensity;
            _renderer = GetComponent<MeshRenderer>();
            MeshFilter filter = GetComponent<MeshFilter>();
            if (filter != null && filter.sharedMesh != null && filter.sharedMesh.triangles.Length >= 3)
            {
                _collider = gameObject.AddComponent<MeshCollider>();
                _collider.sharedMesh = filter.sharedMesh;
            }
            Refresh();
        }

        /// <summary>visible: drawn at all. dim: brightness multiplier (ghosted skin). collidable: can be gazed at / tapped.</summary>
        public void SetMode(bool visible, float dim, bool collidable)
        {
            _visible = visible;
            _dim = dim;
            if (_collider != null) _collider.enabled = visible && collidable;
            if (!visible) { _hover = false; _selected = false; }
            Refresh();
        }

        public void SetHover(bool on)
        {
            if (_hover == on) return;
            _hover = on;
            Refresh();
        }

        public void SetSelected(bool on)
        {
            if (_selected == on) return;
            _selected = on;
            Refresh();
        }

        void Refresh()
        {
            if (_renderer == null) return;
            _renderer.enabled = _visible;
            if (!_visible) return;
            if (_block == null) _block = new MaterialPropertyBlock();

            Color c = BaseColor;
            float k = BaseIntensity * _dim;
            float pulse = 0f;
            if (_selected)
            {
                c = Color.Lerp(c, Color.white, 0.55f);
                k *= 2.4f;
                pulse = 0.25f;
            }
            else if (_hover)
            {
                c = Color.Lerp(c, Color.white, 0.35f);
                k *= 1.8f;
            }
            _renderer.GetPropertyBlock(_block);
            _block.SetColor(HoloProps.Color, c);
            _block.SetFloat(HoloProps.Intensity, k);
            _block.SetFloat(HoloProps.PulseAmount, pulse);
            _block.SetFloat(HoloProps.PulseSpeed, pulse > 0f ? 1.2f : 0f);
            _renderer.SetPropertyBlock(_block);
        }
    }
}
