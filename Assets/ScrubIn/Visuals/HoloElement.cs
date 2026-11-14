using System.Collections.Generic;
using TMPro;
using UnityEngine;

namespace ScrubIn
{
    /// <summary>
    /// Animates everything under a GameObject in and out, so nothing ever pops. Put one on a group:
    ///
    ///     HoloElement e = HoloElement.On(groupObject);          // starts hidden
    ///     e.Show(delay: 0.12f * i);                              // ease-out fade, staggered
    ///     e.Hide();
    ///
    /// With trace = true the lines under it draw themselves from start to end when shown.
    /// It drives HoloGlow's _Alpha and _Draw per renderer (through a property block, so materials stay shared)
    /// and the alpha of any TextMeshPro text. Renderers that sit under a nested HoloElement belong to that
    /// one. If you add children later, call Collect() again.
    /// </summary>
    public class HoloElement : MonoBehaviour
    {
        /// <summary>Lines draw on from start to end when shown, instead of only fading.</summary>
        public bool trace;

        public float Alpha { get; private set; }
        public float Draw { get; private set; }

        /// <summary>The state it is in or animating toward.</summary>
        public bool IsShown { get; private set; }

        readonly List<Renderer> _renderers = new List<Renderer>();
        readonly List<TMP_Text> _texts = new List<TMP_Text>();
        MaterialPropertyBlock _block;

        float _alphaFrom, _alphaTo, _alphaStart, _alphaDuration;
        float _drawFrom, _drawTo, _drawStart, _drawDuration;
        bool _animating;

        /// <summary>Adds (or finds) a HoloElement on <c>go</c>, collects what is under it, and hides it.</summary>
        public static HoloElement On(GameObject go, bool trace = false)
        {
            HoloElement e = go.GetComponent<HoloElement>();
            if (e == null) e = go.AddComponent<HoloElement>();
            e.trace = trace;
            e.Collect();
            e.Snap(false);
            return e;
        }

        /// <summary>Finds the renderers and texts this element drives. Call again after adding children.</summary>
        public void Collect()
        {
            _renderers.Clear();
            _texts.Clear();

            TMP_Text[] texts = GetComponentsInChildren<TMP_Text>(true);
            for (int i = 0; i < texts.Length; i++)
            {
                if (Owner(texts[i].transform) == this) _texts.Add(texts[i]);
            }

            Renderer[] renderers = GetComponentsInChildren<Renderer>(true);
            for (int i = 0; i < renderers.Length; i++)
            {
                Renderer r = renderers[i];
                if (r.GetComponent<TMP_Text>() != null) continue;   // text fades through its own alpha
                if (Owner(r.transform) == this) _renderers.Add(r);
            }

            Apply();
        }

        // The nearest HoloElement at or above t.
        static HoloElement Owner(Transform t)
        {
            while (t != null)
            {
                HoloElement e = t.GetComponent<HoloElement>();
                if (e != null) return e;
                t = t.parent;
            }
            return null;
        }

        public void Show(float delay = 0f, float duration = 0.6f)
        {
            float now = Time.time;
            bool fromHidden = Alpha <= 0.002f;
            IsShown = true;

            _alphaFrom = Alpha;
            _alphaTo = 1f;
            _alphaStart = now + delay;
            _alphaDuration = trace ? Mathf.Min(duration, 0.15f) : duration;

            if (trace)
            {
                if (fromHidden) Draw = 0f;
                _drawFrom = Draw;
                _drawTo = 1f;
                _drawStart = now + delay;
                _drawDuration = duration;
            }
            else
            {
                Draw = 1f;
                _drawFrom = 1f;
                _drawTo = 1f;
                _drawStart = now;
                _drawDuration = 0f;
            }

            _animating = true;
            enabled = true;
            Apply();
        }

        public void Hide(float delay = 0f, float duration = 0.3f)
        {
            float now = Time.time;
            IsShown = false;

            _alphaFrom = Alpha;
            _alphaTo = 0f;
            _alphaStart = now + delay;
            _alphaDuration = duration;

            _drawFrom = Draw;
            _drawTo = Draw;
            _drawStart = now;
            _drawDuration = 0f;

            _animating = true;
            enabled = true;
        }

        public void SetShown(bool shown, float delay = 0f)
        {
            if (shown) Show(delay);
            else Hide(delay);
        }

        /// <summary>Jump straight to shown or hidden with no animation.</summary>
        public void Snap(bool shown)
        {
            IsShown = shown;
            Alpha = shown ? 1f : 0f;
            Draw = (shown || !trace) ? 1f : 0f;
            _animating = false;
            Apply();
        }

        void Update()
        {
            if (!_animating)
            {
                enabled = false;
                return;
            }

            float now = Time.time;
            Alpha = Ease(_alphaFrom, _alphaTo, _alphaStart, _alphaDuration, now);
            Draw = Ease(_drawFrom, _drawTo, _drawStart, _drawDuration, now);

            if (now >= _alphaStart + _alphaDuration && now >= _drawStart + _drawDuration)
            {
                Alpha = _alphaTo;
                Draw = _drawTo;
                if (!IsShown && trace) Draw = 0f;   // ready to trace on again next time
                _animating = false;
            }

            Apply();
        }

        // Ease-out cubic from -> to, starting at 'start' and lasting 'duration' seconds.
        static float Ease(float from, float to, float start, float duration, float now)
        {
            if (now <= start) return from;
            if (duration <= 0f) return to;
            float t = Mathf.Clamp01((now - start) / duration);
            float inv = 1f - t;
            return Mathf.LerpUnclamped(from, to, 1f - inv * inv * inv);
        }

        void Apply()
        {
            if (_block == null) _block = new MaterialPropertyBlock();
            bool visible = Alpha > 0.002f;

            for (int i = 0; i < _renderers.Count; i++)
            {
                Renderer r = _renderers[i];
                if (r == null) continue;
                if (r.enabled != visible) r.enabled = visible;
                if (!visible) continue;

                r.GetPropertyBlock(_block);
                _block.SetFloat(HoloProps.Alpha, Alpha);
                _block.SetFloat(HoloProps.Draw, Draw);
                r.SetPropertyBlock(_block);
            }

            for (int i = 0; i < _texts.Count; i++)
            {
                TMP_Text text = _texts[i];
                if (text == null) continue;
                if (text.enabled != visible) text.enabled = visible;
                if (visible) text.alpha = Alpha;
            }
        }
    }
}
