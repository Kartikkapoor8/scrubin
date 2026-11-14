using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR;

namespace ScrubIn
{
    /// <summary>
    /// Keyboard controls for the operator: in the editor, or on the headset with a Bluetooth keyboard paired.
    /// Nothing here depends on the headset's hand input. Full key table in CLAUDE.md.
    /// </summary>
    public class OperatorInput : MonoBehaviour
    {
        const float RepeatDelay = 0.35f;
        const float RepeatInterval = 0.05f;
        const float FastAfter = 1.2f;

        ScrubInBootstrap _bootstrap;
        ScrubInContext _ctx;
        HoloInput _holoInput;
        bool _holoWound;
        readonly Dictionary<KeyCode, float> _nextRepeat = new Dictionary<KeyCode, float>();
        readonly Dictionary<KeyCode, float> _heldSince = new Dictionary<KeyCode, float>();

        public void Init(ScrubInBootstrap bootstrap, ScrubInContext ctx, HoloInput holoInput)
        {
            _bootstrap = bootstrap;
            _ctx = ctx;
            _holoInput = holoInput;
            _holoWound = ctx.Procedure.options.holoWound;
        }

        void Update()
        {
            if (_ctx == null) return;
            PatientAlignment alignment = _ctx.Alignment;

            if (Input.GetKeyDown(KeyCode.L)) alignment.ToggleLocked();

            // Enter does what an air tap does (places the outline).
            if (Input.GetKeyDown(KeyCode.Return) || Input.GetKeyDown(KeyCode.KeypadEnter)) _holoInput.Tap();

            if (Input.GetKeyDown(KeyCode.W))
            {
                _holoWound = !_holoWound;
                ScrubInEvents.RaiseLayerVisibility(ArmOutline.HoloWoundLayer, _holoWound);
            }

            // C: back in front of the wearer (in the editor preview it also resets the camera).
            if (Input.GetKeyDown(KeyCode.C)) _bootstrap.Recenter();

#if UNITY_EDITOR
            if (Input.GetKeyDown(KeyCode.F1)) _showLegend = !_showLegend;
#endif

            if (alignment.Locked) return;

            bool fine = Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift);
            float move = fine ? 0.001f : 0.005f;
            float turn = fine ? 0.5f : 2f;
            float tilt = fine ? 0.25f : 1f;

            float right = move * (Steps(KeyCode.RightArrow) - Steps(KeyCode.LeftArrow));
            float away = move * (Steps(KeyCode.UpArrow) - Steps(KeyCode.DownArrow));
            float up = move * (Steps(KeyCode.PageUp) - Steps(KeyCode.PageDown));
            if (right != 0f || up != 0f || away != 0f) alignment.Nudge(right, up, away);

            float yaw = turn * (Steps(KeyCode.E) - Steps(KeyCode.Q));
            float roll = turn * (Steps(KeyCode.X) - Steps(KeyCode.Z));
            float pitch = tilt * (Steps(KeyCode.Alpha1) - Steps(KeyCode.Alpha2));
            if (yaw != 0f || pitch != 0f || roll != 0f) alignment.Rotate(yaw, pitch, roll);

            int grow = Steps(KeyCode.RightBracket) - Steps(KeyCode.LeftBracket);
            if (grow != 0) alignment.ScaleBy(Mathf.Pow(1.01f, grow));
        }

        // How many steps a key asks for this frame: 0 if none, 1 on a tap and while it repeats, 4 once it has
        // been held for over a second. Taps stay precise; holding a key covers real distance quickly.
        int Steps(KeyCode key)
        {
            float now = Time.unscaledTime;
            if (Input.GetKeyDown(key))
            {
                _heldSince[key] = now;
                _nextRepeat[key] = now + RepeatDelay;
                return 1;
            }

            float next;
            if (Input.GetKey(key) && _nextRepeat.TryGetValue(key, out next) && now >= next)
            {
                _nextRepeat[key] = now + RepeatInterval;
                float since;
                return _heldSince.TryGetValue(key, out since) && now - since > FastAfter ? 4 : 1;
            }
            return 0;
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

            GUILayout.BeginArea(new Rect(8f, 8f, 640f, 150f + 34f * warnings.Count), GUI.skin.box);

            string device = _ctx.IsHeadset
                ? "HEADSET (" + XRSettings.loadedDeviceName + ")"
                : "EDITOR PREVIEW, no headset: right-drag orbits, scroll zooms, C resets the view";
            GUILayout.Label("VIPER operator  |  " + device + "  |  " + Mathf.RoundToInt(1f / Mathf.Max(Time.smoothDeltaTime, 0.0001f)) + " fps", _text);

            if (a.Locked)
            {
                GUILayout.Label("Outline PLACED (locked).  L = pick it up again  |  W = hologram wound line " + (_holoWound ? "ON" : "off"), _text);
            }
            else
            {
                GUILayout.Label("Outline NOT placed" + (a.Following ? " (following the wearer's gaze)" : "")
                                + ".  Enter or air tap = place  |  L = lock / unlock", _text);
                GUILayout.Label("Arrows move 5 mm  |  PgUp/PgDn height  |  Q/E yaw 2\u00B0  |  Z/X roll  |  1/2 pitch  |  [ ] scale  |  Shift = fine", _text);
                GUILayout.Label("Hold a key to repeat (it speeds up after a second)  |  C = back in front of the wearer", _text);
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
