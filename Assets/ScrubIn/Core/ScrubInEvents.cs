using System;
using UnityEngine;

namespace ScrubIn
{
    /// <summary>
    /// SHARED CONTRACT between Core, Visuals, Anatomy and Attending. See CLAUDE.md.
    /// Subscribe with +=. Fire only through the Raise helpers: every listener runs in its own try/catch,
    /// so one module throwing can never stop the others (or the demo).
    /// Change only by agreement, and only by adding.
    /// </summary>
    public static class ScrubInEvents
    {
        /// <summary>The procedure moved to step <c>index</c>. Raised by Core.</summary>
        public static event Action<int, StepData> StepChanged;

        /// <summary>Suture <c>index</c> (0-based) finished its animation. Raised by Visuals.</summary>
        public static event Action<int> StitchCompleted;

        /// <summary>A named layer should animate in (true) or out (false). Raised by Core.</summary>
        public static event Action<string, bool> LayerVisibility;

        /// <summary>The Attending card should type this line.</summary>
        public static event Action<string> AttendingSay;

        /// <summary>The operator locked (true) or unlocked (false) alignment. Raised by Core.</summary>
        public static event Action<bool> AlignmentLocked;

        public static void RaiseStepChanged(int index, StepData step)
        {
            Action<int, StepData> handler = StepChanged;
            if (handler == null) return;
            Delegate[] list = handler.GetInvocationList();
            for (int i = 0; i < list.Length; i++)
            {
                try { ((Action<int, StepData>)list[i])(index, step); }
                catch (Exception e) { Report("StepChanged", e); }
            }
        }

        public static void RaiseStitchCompleted(int index)
        {
            Action<int> handler = StitchCompleted;
            if (handler == null) return;
            Delegate[] list = handler.GetInvocationList();
            for (int i = 0; i < list.Length; i++)
            {
                try { ((Action<int>)list[i])(index); }
                catch (Exception e) { Report("StitchCompleted", e); }
            }
        }

        public static void RaiseLayerVisibility(string layer, bool visible)
        {
            Action<string, bool> handler = LayerVisibility;
            if (handler == null) return;
            Delegate[] list = handler.GetInvocationList();
            for (int i = 0; i < list.Length; i++)
            {
                try { ((Action<string, bool>)list[i])(layer, visible); }
                catch (Exception e) { Report("LayerVisibility", e); }
            }
        }

        public static void RaiseAttendingSay(string text)
        {
            Action<string> handler = AttendingSay;
            if (handler == null) return;
            Delegate[] list = handler.GetInvocationList();
            for (int i = 0; i < list.Length; i++)
            {
                try { ((Action<string>)list[i])(text); }
                catch (Exception e) { Report("AttendingSay", e); }
            }
        }

        public static void RaiseAlignmentLocked(bool locked)
        {
            Action<bool> handler = AlignmentLocked;
            if (handler == null) return;
            Delegate[] list = handler.GetInvocationList();
            for (int i = 0; i < list.Length; i++)
            {
                try { ((Action<bool>)list[i])(locked); }
                catch (Exception e) { Report("AlignmentLocked", e); }
            }
        }

        /// <summary>Drops every subscriber. The bootstrap calls this once at startup; nobody else should.</summary>
        public static void ClearAll()
        {
            StepChanged = null;
            StitchCompleted = null;
            LayerVisibility = null;
            AttendingSay = null;
            AlignmentLocked = null;
        }

        static void Report(string eventName, Exception e)
        {
            Debug.LogError("[ScrubIn] A " + eventName + " listener threw (the others still ran): " + e);
        }
    }
}
