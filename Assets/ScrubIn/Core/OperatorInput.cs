using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR;

namespace ScrubIn
{
    /// <summary>
    /// Keyboard controls for the operator at the PC. This is the guaranteed demo path: nothing here depends on
    /// the headset's hand input. Full key table in CLAUDE.md.
    /// Build step 1 covers alignment. Procedure keys (Space, S, R, V, A, H) arrive with build step 2.
    /// </summary>
    public class OperatorInput : MonoBehaviour
    {
        const float RepeatDelay = 0.35f;
        const float RepeatInterval = 0.05f;

        ScrubInBootstrap _bootstrap;
        ScrubInContext _ctx;
        readonly Dictionary<KeyCode, float> _nextRepeat = new Dictionary<KeyCode, float>();

        public void Init(ScrubInBootstrap bootstrap, ScrubInContext ctx)
        {
            _bootstrap = bootstrap;
            _ctx = ctx;
        }

        void Update()
        {
            if (_ctx == null) return;
            PatientAlignment alignment = _ctx.Alignment;

            if (Input.GetKeyDown(KeyCode.L)) alignment.ToggleLocked();

#if UNITY_EDITOR
            if (Input.GetKeyDown(KeyCode.F1)) _showLegend = !_showLegend;
#endif

            if (alignment.Locked) return;   // locked: the arrows belong to the procedure (build step 2)

            bool fine = Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift);
            float move = fine ? 0.001f : 0.005f;
            float turn = fine ? 0.5f : 2f;
            float tilt = fine ? 0.25f : 1f;

            if (Pressed(KeyCode.LeftArrow)) alignment.Nudge(-move, 0f, 0f);
            if (Pressed(KeyCode.RightArrow)) alignment.Nudge(move, 0f, 0f);
            if (Pressed(KeyCode.UpArrow)) alignment.Nudge(0f, 0f, move);
            if (Pressed(KeyCode.DownArrow)) alignment.Nudge(0f, 0f, -move);
            if (Pressed(KeyCode.PageUp)) alignment.Nudge(0f, move, 0f);
            if (Pressed(KeyCode.PageDown)) alignment.Nudge(0f, -move, 0f);

            if (Pressed(KeyCode.Q)) alignment.Rotate(-turn, 0f, 0f);
            if (Pressed(KeyCode.E)) alignment.Rotate(turn, 0f, 0f);
            if (Pressed(KeyCode.Z)) alignment.Rotate(0f, 0f, -turn);
            if (Pressed(KeyCode.X)) alignment.Rotate(0f, 0f, turn);
            if (Pressed(KeyCode.Alpha1)) alignment.Rotate(0f, tilt, 0f);
            if (Pressed(KeyCode.Alpha2)) alignment.Rotate(0f, -tilt, 0f);

            if (Pressed(KeyCode.LeftBracket)) alignment.ScaleBy(1f / 1.01f);
            if (Pressed(KeyCode.RightBracket)) alignment.ScaleBy(1.01f);

            if (Input.GetKeyDown(KeyCode.C)) _bootstrap.Recenter();
        }

        // True on the frame the key goes down, then repeatedly while it is held.
        bool Pressed(KeyCode key)
        {
            float now = Time.unscaledTime;
            if (Input.GetKeyDown(key))
            {
                _nextRepeat[key] = now + RepeatDelay;
                return true;
            }
            float next;
            if (Input.GetKey(key) && _nextRepeat.TryGetValue(key, out next) && now >= next)
            {
                _nextRepeat[key] = now + RepeatInterval;
                return true;
            }
            return false;
        }

#if UNITY_EDITOR
        // Operator legend. IMGUI draws to the editor Game view only; it is not part of what the headset shows.
        bool _showLegend = true;
        GUIStyle _text;
        GUIStyle _warn;

        void OnGUI()
        {
            if (!_showLegend || _ctx == null) return;

            if (_text == null)
            {
                _text = new GUIStyle(GUI.skin.label);
                _text.fontSize = 11;
                _text.wordWrap = false;
                _text.normal.textColor = new Color(0.78f, 0.95f, 1f);
                _warn = new GUIStyle(_text);
                _warn.wordWrap = true;
                _warn.normal.textColor = new Color(1f, 0.71f, 0.28f);
            }

            PatientAlignment a = _ctx.Alignment;
            IList<string> warnings = ScrubInLog.Warnings;

            GUILayout.BeginArea(new Rect(8f, 8f, 600f, 150f + 34f * warnings.Count), GUI.skin.box);

            string device = _ctx.IsHeadset
                ? "HEADSET (" + XRSettings.loadedDeviceName + ")"
                : "DESKTOP PREVIEW, no headset: right-drag orbits, scroll zooms";
            GUILayout.Label("ScrubIn operator  |  " + device + "  |  " + Mathf.RoundToInt(1f / Mathf.Max(Time.smoothDeltaTime, 0.0001f)) + " fps", _text);

            if (a.Locked)
            {
                GUILayout.Label("Alignment LOCKED.  L = unlock (shows the outline again).", _text);
            }
            else
            {
                GUILayout.Label("Alignment UNLOCKED.  L = lock when the outline sits on the arm.", _text);
                GUILayout.Label("Arrows move 5 mm  |  PgUp/PgDn height  |  Q/E yaw 2\u00B0  |  Z/X roll  |  1/2 pitch  |  [ ] scale  |  Shift = fine", _text);
                GUILayout.Label("C = re-place 0.7 m in front of the wearer, 0.45 m below their head", _text);
            }

            Vector3 p = a.PivotWorld;
            GUILayout.Label("wound at (" + p.x.ToString("F3") + ", " + p.y.ToString("F3") + ", " + p.z.ToString("F3") + ") m"
                            + "   yaw " + a.Yaw.ToString("F1") + "\u00B0   pitch " + a.Pitch.ToString("F2") + "\u00B0   roll " + a.Roll.ToString("F1") + "\u00B0"
                            + "   scale " + (a.Scale * 100f).ToString("F0") + "%", _text);
            GUILayout.Label("F1 hides this legend (editor only; it is never sent to the headset)", _text);

            for (int i = 0; i < warnings.Count; i++)
            {
                GUILayout.Label("! " + warnings[i], _warn);
            }

            GUILayout.EndArea();
        }
#endif
    }
}
