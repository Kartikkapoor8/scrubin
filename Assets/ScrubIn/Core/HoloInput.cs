using System;
using UnityEngine;
#if UNITY_WSA
using UnityEngine.XR.WSA;
using UnityEngine.XR.WSA.Input;
#endif

namespace ScrubIn
{
    /// <summary>
    /// The headset's own input, so the app is usable with no keyboard:
    ///  - Air tap places the outline (locks alignment). Once it is placed, taps do nothing, so a hand doing
    ///    pretend surgery in view of the headset cannot disturb anything.
    ///  - Press-and-hold picks it up again, only if options.holdToReposition is on (off by default).
    ///  - Each frame the HoloLens is told to stabilise holograms at the wound (options.focusPoint).
    /// Never required: every action here also has an operator key (Enter = air tap, L = lock / unlock).
    /// The HoloLens APIs are only touched when an XR device is actually active.
    /// </summary>
    public class HoloInput : MonoBehaviour
    {
        const float TapDebounce = 0.4f;

        ScrubInContext _ctx;
        bool _deviceStarted;
        float _lastTap = -10f;

        /// <summary>True while the headset can see a hand.</summary>
        public bool HandVisible { get; private set; }

        /// <summary>World position of that hand (only meaningful while HandVisible).</summary>
        public Vector3 HandPosition { get; private set; }

        public void Init(ScrubInContext ctx)
        {
            _ctx = ctx;
        }

        /// <summary>What an air tap does. Also bound to Enter for the operator.</summary>
        public void Tap()
        {
            if (_ctx == null) return;
            if (Time.unscaledTime - _lastTap < TapDebounce) return;
            _lastTap = Time.unscaledTime;

            if (!_ctx.Alignment.Locked) _ctx.Alignment.SetLocked(true);
        }

        /// <summary>What press-and-hold does: pick the outline up again so it can be re-placed.</summary>
        public void Hold()
        {
            if (_ctx == null || !_ctx.Procedure.options.holdToReposition) return;
            if (!_ctx.Alignment.Locked) return;

            _ctx.Alignment.SetLocked(false);
            _ctx.Alignment.SetFollowing(_ctx.Procedure.options.followGazeUntilPlaced);
        }

        void Update()
        {
            if (_ctx != null && _ctx.IsHeadset && !_deviceStarted)
            {
                _deviceStarted = true;
                StartDevice();
            }
        }

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
                _recognizer.SetRecognizableGestures(GestureSettings.Tap | GestureSettings.Hold);
                _recognizer.Tapped += OnTapped;
                _recognizer.HoldCompleted += OnHoldCompleted;
                _recognizer.StartCapturingGestures();

                InteractionManager.InteractionSourceUpdated += OnSourceUpdated;
                InteractionManager.InteractionSourceLost += OnSourceLost;
            }
            catch (Exception e)
            {
                ScrubInLog.Warn("Air tap is unavailable (" + e.Message + "). Use the keyboard: Enter places the outline.");
            }
        }

        void OnTapped(TappedEventArgs args)
        {
            Tap();
        }

        void OnHoldCompleted(HoldCompletedEventArgs args)
        {
            Hold();
        }

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
            // Point it at the wound, facing the wearer.
            if (_ctx == null || !_ctx.IsHeadset || !_ctx.Procedure.options.focusPoint) return;
            if (!_ctx.Alignment.Placed) return;
            HolographicSettings.SetFocusPointForFrame(_ctx.Alignment.PivotWorld, -_ctx.Head.forward);
        }

        void OnDestroy()
        {
            if (_recognizer == null) return;
            try
            {
                InteractionManager.InteractionSourceUpdated -= OnSourceUpdated;
                InteractionManager.InteractionSourceLost -= OnSourceLost;
                _recognizer.Tapped -= OnTapped;
                _recognizer.HoldCompleted -= OnHoldCompleted;
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
            // Not a Windows Mixed Reality build: no air tap. The keyboard path covers everything.
        }
#endif
    }
}
