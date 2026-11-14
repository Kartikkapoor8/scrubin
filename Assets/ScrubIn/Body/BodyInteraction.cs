using System;
using System.Collections.Generic;
using UnityEngine;
#if UNITY_WSA
using UnityEngine.XR.WSA;
#endif
#if UNITY_WSA || UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
using UnityEngine.Windows.Speech;
#endif

namespace ScrubIn
{
    /// <summary>
    /// The whole headset experience: a holographic body on the table that you can explore. No HUD.
    ///
    /// Placing: the body follows your gaze (sitting on a real table when spatial mapping finds one) until an air
    ///   tap puts it down. Tap-and-hold and drag: starting on the body moves it, starting off it rotates it.
    ///   Voice: "bigger", "smaller", "up", "down", "reset" ("turn left" / "turn right" too).
    /// Exploring: the part under your gaze (or under your hand, when HoloLens can see it) glows. An air tap selects
    ///   it: stronger glow + a small name tag. Tap empty space to clear. Voice: "skin", "muscles", "skeleton",
    ///   "organs", "x-ray".
    /// Editor / remoting keyboard: F1-F5 layers, F6 reset, +/- size, PageUp/PageDown height, mouse hover + left
    ///   click = gaze + tap in the desktop preview, Enter = tap.
    /// </summary>
    public class BodyInteraction : MonoBehaviour, IScrubInModule
    {
        const int SpatialLayer = 31;
        const int BodyMask = 1 << 0;
        const float LabelCap = 0.011f;
        const float LabelLift = 0.045f;

        ScrubInContext _ctx;
        HoloInput _input;
        BodyBuilder.Model _model;
        BodyPart _hover;
        BodyPart _selected;
        Vector3 _hoverPointLocal;
        Vector3 _selectedPointLocal;
        HoloLabel _label;

        bool _dragging;
        bool _dragMove;
        Vector3 _dragStartPivot;
        float _dragStartYaw;

        public void Build(ScrubInContext ctx)
        {
            _ctx = ctx;
            _model = BodyBuilder.Build(ctx.PatientRoot);
            Debug.Log("[ScrubIn] Body built: " + _model.Parts.Count + " parts, " + _model.Triangles + " triangles.");

            _input = ctx.Root.GetComponent<HoloInput>();
            if (_input != null)
            {
                _input.Tapped += OnTap;
                _input.DragStarted += OnDragStarted;
                _input.DragUpdated += OnDragUpdated;
                _input.DragEnded += OnDragEnded;
            }

            _label = LabelBuilder.Create(ctx.Root, "", Vector3.zero, LabelCap, Color.white);
            _label.gameObject.SetActive(false);

            StartVoice();
            if (ctx.IsHeadset) StartSpatialMapping();
        }

        // =====================================================================================================
        // Commands (voice, keyboard, gestures all land here)
        // =====================================================================================================

        public void SetMode(BodyMode mode)
        {
            _model.ApplyMode(mode);
            if (_selected != null && !_selected.Visible) Select(null, Vector3.zero);
            if (_hover != null && !_hover.Visible) _hover = null;
        }

        public void ResetAll()
        {
            Select(null, Vector3.zero);
            SetMode(BodyMode.Skin);
            PatientAlignment a = _ctx.Alignment;
            a.SetLocked(false);
            a.SetScale(1f);
            a.PlaceInFrontOfHead();
            a.SetFollowing(_ctx.IsHeadset);
            FreezeSpatialMapping(false);
        }

        void ScaleBody(float factor)
        {
            _ctx.Alignment.ScaleBy(factor);
        }

        void RaiseBody(float meters)
        {
            PatientAlignment a = _ctx.Alignment;
            a.SetPivotYaw(a.PivotWorld + Vector3.up * meters, a.Yaw);
        }

        void TurnBody(float degrees)
        {
            PatientAlignment a = _ctx.Alignment;
            a.SetPivotYaw(a.PivotWorld, a.Yaw + degrees);
        }

        void OnTap()
        {
            PatientAlignment a = _ctx.Alignment;
            if (!a.Locked)
            {
                // First tap puts the body down where it is.
                a.SetLocked(true);
                a.SurfaceTarget = null;
                FreezeSpatialMapping(true);
                return;
            }
            if (_hover != null && _hover != _selected) Select(_hover, _hoverPointLocal);
            else Select(null, Vector3.zero);
        }

        void Select(BodyPart part, Vector3 pointLocal)
        {
            if (_selected != null) _selected.SetSelected(false);
            _selected = part;
            _selectedPointLocal = pointLocal;
            if (_selected != null)
            {
                _selected.SetSelected(true);
                _label.SetText(_selected.DisplayName);
                _label.gameObject.SetActive(true);
                PositionLabel();
            }
            else
            {
                _label.gameObject.SetActive(false);
            }
        }

        void OnDragStarted()
        {
            PatientAlignment a = _ctx.Alignment;
            if (!a.Locked) { a.SetLocked(true); a.SurfaceTarget = null; FreezeSpatialMapping(true); }
            _dragging = true;
            _dragMove = _hover != null;          // grab the body to move it; grab empty space to turn it
            _dragStartPivot = a.PivotWorld;
            _dragStartYaw = a.Yaw;
        }

        void OnDragUpdated(Vector3 delta)
        {
            if (!_dragging) return;
            PatientAlignment a = _ctx.Alignment;
            if (_dragMove)
            {
                a.SetPivotYaw(_dragStartPivot + delta * 1.6f, _dragStartYaw);
            }
            else
            {
                Vector3 right = Vector3.Cross(Vector3.up, a.FlatForward());
                a.SetPivotYaw(_dragStartPivot, _dragStartYaw + Vector3.Dot(delta, right) * 360f);
            }
        }

        void OnDragEnded()
        {
            _dragging = false;
        }

        // =====================================================================================================
        // Per frame: hover, table snapping, editor keys, label
        // =====================================================================================================

        void Update()
        {
            if (_ctx == null || _model == null) return;
            UpdateHover();
            UpdateSurfaceTarget();
            UpdateKeys();
            if (_input != null) _input.FocusPoint = _hover != null ? _model.Root.TransformPoint(_hoverPointLocal) : (Vector3?)null;
        }

        void LateUpdate()
        {
            if (_selected != null) PositionLabel();
        }

        void UpdateHover()
        {
            Ray ray;
            Transform head = _ctx.Head;
            if (!_ctx.IsHeadset && _ctx.Camera != null && Input.mousePresent)
            {
                ray = _ctx.Camera.ScreenPointToRay(Input.mousePosition);
            }
            else if (_input != null && _input.HandVisible)
            {
                // Point with the hand: the ray from the eyes through the hand.
                Vector3 dir = _input.HandPosition - head.position;
                ray = dir.sqrMagnitude > 0.01f ? new Ray(head.position, dir.normalized) : new Ray(head.position, head.forward);
            }
            else
            {
                ray = new Ray(head.position, head.forward);
            }

            BodyPart hit = null;
            RaycastHit info;
            if (_ctx.Alignment.Locked && Physics.Raycast(ray, out info, 4f, BodyMask, QueryTriggerInteraction.Ignore))
            {
                hit = info.collider.GetComponent<BodyPart>();
                if (hit != null) _hoverPointLocal = _model.Root.InverseTransformPoint(info.point);
            }
            if (hit == _hover) return;
            if (_hover != null) _hover.SetHover(false);
            _hover = hit;
            if (_hover != null) _hover.SetHover(true);
        }

        void UpdateSurfaceTarget()
        {
            PatientAlignment a = _ctx.Alignment;
            if (!_ctx.IsHeadset || a.Locked || !a.Following) { if (!a.Locked) a.SurfaceTarget = null; return; }
            RaycastHit info;
            Transform head = _ctx.Head;
            if (Physics.Raycast(head.position, head.forward, out info, 2.5f, 1 << SpatialLayer, QueryTriggerInteraction.Ignore)
                && info.normal.y > 0.8f && info.distance > 0.35f)
            {
                a.SurfaceTarget = info.point;
            }
            else
            {
                a.SurfaceTarget = null;
            }
        }

        void UpdateKeys()
        {
            if (Input.GetKeyDown(KeyCode.F1)) SetMode(BodyMode.Skin);
            if (Input.GetKeyDown(KeyCode.F2)) SetMode(BodyMode.Muscles);
            if (Input.GetKeyDown(KeyCode.F3)) SetMode(BodyMode.Skeleton);
            if (Input.GetKeyDown(KeyCode.F4)) SetMode(BodyMode.Organs);
            if (Input.GetKeyDown(KeyCode.F5)) SetMode(BodyMode.XRay);
            if (Input.GetKeyDown(KeyCode.F6)) ResetAll();
            if (Input.GetKeyDown(KeyCode.KeypadPlus) || Input.GetKeyDown(KeyCode.Equals)) ScaleBody(1.15f);
            if (Input.GetKeyDown(KeyCode.KeypadMinus) || Input.GetKeyDown(KeyCode.Minus)) ScaleBody(1f / 1.15f);
            if (!_ctx.IsHeadset && Input.GetMouseButtonDown(0) && _input != null) _input.Tap();
        }

        void PositionLabel()
        {
            if (_selected == null || _label == null) return;
            Vector3 world = _model.Root.TransformPoint(_selectedPointLocal) + Vector3.up * LabelLift;
            _label.transform.position = world;
        }

        // =====================================================================================================
        // Voice (offline on HoloLens 1)
        // =====================================================================================================

#if UNITY_WSA || UNITY_STANDALONE_WIN || UNITY_EDITOR_WIN
        KeywordRecognizer _keywords;
        Dictionary<string, Action> _commands;

        void StartVoice()
        {
            _commands = new Dictionary<string, Action>
            {
                { "skin", () => SetMode(BodyMode.Skin) },
                { "muscles", () => SetMode(BodyMode.Muscles) },
                { "muscle", () => SetMode(BodyMode.Muscles) },
                { "skeleton", () => SetMode(BodyMode.Skeleton) },
                { "bones", () => SetMode(BodyMode.Skeleton) },
                { "organs", () => SetMode(BodyMode.Organs) },
                { "x-ray", () => SetMode(BodyMode.XRay) },
                { "x ray", () => SetMode(BodyMode.XRay) },
                { "bigger", () => ScaleBody(1.15f) },
                { "smaller", () => ScaleBody(1f / 1.15f) },
                { "up", () => RaiseBody(0.03f) },
                { "down", () => RaiseBody(-0.03f) },
                { "turn left", () => TurnBody(15f) },
                { "turn right", () => TurnBody(-15f) },
                { "reset", ResetAll },
            };
            try
            {
                string[] words = new string[_commands.Count];
                _commands.Keys.CopyTo(words, 0);
                _keywords = new KeywordRecognizer(words, ConfidenceLevel.Low);
                _keywords.OnPhraseRecognized += OnPhrase;
                _keywords.Start();
            }
            catch (Exception e)
            {
                ScrubInLog.Warn("Voice commands unavailable (" + e.Message + "). Keyboard: F1-F6.");
                _keywords = null;
            }
        }

        void OnPhrase(PhraseRecognizedEventArgs args)
        {
            Action a;
            if (_commands != null && _commands.TryGetValue(args.text, out a)) a();
        }

        void StopVoice()
        {
            if (_keywords == null) return;
            try
            {
                _keywords.OnPhraseRecognized -= OnPhrase;
                if (_keywords.IsRunning) _keywords.Stop();
                _keywords.Dispose();
            }
            catch (Exception) { }
            _keywords = null;
        }
#else
        void StartVoice() { }
        void StopVoice() { }
#endif

        // =====================================================================================================
        // Spatial mapping (find the real table)
        // =====================================================================================================

#if UNITY_WSA
#pragma warning disable 0618
        SpatialMappingCollider _spatial;

        void StartSpatialMapping()
        {
            try
            {
                GameObject go = new GameObject("Spatial mapping");
                go.transform.SetParent(_ctx.Root, false);
                go.layer = SpatialLayer;
                _spatial = go.AddComponent<SpatialMappingCollider>();
                _spatial.layer = SpatialLayer;
                _spatial.lodType = SpatialMappingBase.LODType.Low;
                _spatial.secondsBetweenUpdates = 2.5f;
                _spatial.enableCollisions = true;
                _spatial.halfBoxExtents = new Vector3(2.5f, 2f, 2.5f);
            }
            catch (Exception e)
            {
                ScrubInLog.Warn("Spatial mapping unavailable (" + e.Message + "); the body floats at a fixed distance until placed.");
                _spatial = null;
            }
        }

        void FreezeSpatialMapping(bool freeze)
        {
            if (_spatial != null) _spatial.freezeUpdates = freeze;
        }
#pragma warning restore 0618
#else
        void StartSpatialMapping() { }
        void FreezeSpatialMapping(bool freeze) { }
#endif

        void OnDestroy()
        {
            StopVoice();
            if (_input != null)
            {
                _input.Tapped -= OnTap;
                _input.DragStarted -= OnDragStarted;
                _input.DragUpdated -= OnDragUpdated;
                _input.DragEnded -= OnDragEnded;
            }
        }
    }
}
