using System;
using UnityEngine;
#if UNITY_WSA
using UnityEngine.XR.WSA;
using UnityEngine.XR.WSA.Input;
#endif

namespace ScrubIn
{
    /// <summary>
    /// The headset's own input (HoloLens 1, legacy Windows Mixed Reality API), reported as plain events:
    ///  - Tapped: an air tap (also Enter / left click in the editor).
    ///  - Drag started / updated / ended: tap-and-hold then move the hand (ManipulationTranslate). The delta is
    ///    the hand's movement in world space since the hold began.
    ///  - HandVisible / HandPosition: the rough hand position HoloLens 1 reports while a hand is in view.
    /// The HoloLens APIs are only touched when an XR device is actually active.
    /// </summary>
    public class HoloInput : MonoBehaviour
    {
        const float TapDebounce = 0.3f;

        ScrubInContext _ctx;
        bool _deviceStarted;
        float _lastTap = -10f;

        public event Action Tapped;
        public event Action DragStarted;
        public event Action<Vector3> DragUpdated;
        public event Action DragEnded;

        /// <summary>True while the headset can see a hand.</summary>
        public bool HandVisible { get; private set; }

        /// <summary>World position of that hand (only meaningful while HandVisible).</summary>
        public Vector3 HandPosition { get; private set; }

        /// <summary>Where the HoloLens should stabilise holograms this frame (set by whoever owns the content).</summary>
        public Vector3? FocusPoint { get; set; }

        public void Init(ScrubInContext ctx)
        {
            _ctx = ctx;
        }

        /// <summary>An air tap. Also bound to Enter for the operator.</summary>
        public void Tap()
        {
            if (_ctx == null) return;
            if (Time.unscaledTime - _lastTap < TapDebounce) return;
            _lastTap = Time.unscaledTime;

            if (Tapped != null) Tapped();
            else if (!_ctx.Alignment.Locked) _ctx.Alignment.SetLocked(true);
        }

        void Update()
        {
            if (_ctx != null && _ctx.IsHeadset && !_deviceStarted)
            {
                _deviceStarted = true;
                StartDevice();
            }
        }

        void RaiseDragStarted() { if (DragStarted != null) DragStarted(); }
        void RaiseDragUpdated(Vector3 delta) { if (DragUpdated != null) DragUpdated(delta); }
        void RaiseDragEnded() { if (DragEnded != null) DragEnded(); }

#if UNITY_WSA
        // The built-in (legacy) Windows Mixed Reality API is what HoloLens 1 uses in Unity 2019.4. Unity marks
        // it obsolete because it is removed in 2020; that is expected here.
#pragma warning disable 0618
        GestureRecognizer _recognizer;

        void StartDevice()
        {
            try
            {
                _recognizer = new GestureRecognizer();
                _recognizer.SetRecognizableGestures(GestureSettings.Tap | GestureSettings.ManipulationTranslate);
                _recognizer.Tapped += OnTapped;
                _recognizer.ManipulationStarted += OnManipulationStarted;
                _recognizer.ManipulationUpdated += OnManipulationUpdated;
                _recognizer.ManipulationCompleted += OnManipulationCompleted;
                _recognizer.ManipulationCanceled += OnManipulationCanceled;
                _recognizer.StartCapturingGestures();

                InteractionManager.InteractionSourceUpdated += OnSourceUpdated;
                InteractionManager.InteractionSourceLost += OnSourceLost;
            }
            catch (Exception e)
            {
                ScrubInLog.Warn("Air tap is unavailable (" + e.Message + "). Use the keyboard: Enter = tap.");
            }
        }

        void OnTapped(TappedEventArgs args) { Tap(); }
        void OnManipulationStarted(ManipulationStartedEventArgs args) { RaiseDragStarted(); }
        void OnManipulationUpdated(ManipulationUpdatedEventArgs args) { RaiseDragUpdated(args.cumulativeDelta); }
        void OnManipulationCompleted(ManipulationCompletedEventArgs args) { RaiseDragEnded(); }
        void OnManipulationCanceled(ManipulationCanceledEventArgs args) { RaiseDragEnded(); }

        void OnSourceUpdated(InteractionSourceUpdatedEventArgs args)
        {
            if (args.state.source.kind != InteractionSourceKind.Hand) return;
            Vector3 position;
            if (args.state.sourcePose.TryGetPosition(out position))
            {
                HandPosition = position;
                HandVisible = true;
            }
        }

        void OnSourceLost(InteractionSourceLostEventArgs args)
        {
            if (args.state.source.kind == InteractionSourceKind.Hand) HandVisible = false;
        }

        void LateUpdate()
        {
            // Holograms here do not write depth, so the HoloLens cannot work out where to stabilise on its own.
            if (_ctx == null || !_ctx.IsHeadset || !_ctx.Procedure.options.focusPoint) return;
            if (!_ctx.Alignment.Placed) return;
            Vector3 point = FocusPoint.HasValue ? FocusPoint.Value : _ctx.Alignment.PivotWorld;
            HolographicSettings.SetFocusPointForFrame(point, -_ctx.Head.forward);
        }

        void OnDestroy()
        {
            if (_recognizer == null) return;
            try
            {
                InteractionManager.InteractionSourceUpdated -= OnSourceUpdated;
                InteractionManager.InteractionSourceLost -= OnSourceLost;
                _recognizer.Tapped -= OnTapped;
                _recognizer.ManipulationStarted -= OnManipulationStarted;
                _recognizer.ManipulationUpdated -= OnManipulationUpdated;
                _recognizer.ManipulationCompleted -= OnManipulationCompleted;
                _recognizer.ManipulationCanceled -= OnManipulationCanceled;
                _recognizer.StopCapturingGestures();
                _recognizer.Dispose();
            }
            catch (Exception)
            {
                // Shutting down; nothing useful to do.
            }
            _recognizer = null;
        }
#pragma warning restore 0618
#else
        void StartDevice()
        {
            // Not a Windows Mixed Reality build: no air tap. The keyboard / mouse path covers everything.
        }
#endif
    }
}
