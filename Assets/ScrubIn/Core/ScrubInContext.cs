using System.Collections.Generic;
using UnityEngine;

namespace ScrubIn
{
    /// <summary>
    /// How a feature plugs in without anyone editing the bootstrap. Implement this on a MonoBehaviour (it gets
    /// its own GameObject under the ScrubIn root) or on a plain class with a parameterless constructor.
    /// The bootstrap calls Build exactly once at startup. See CLAUDE.md.
    /// </summary>
    public interface IScrubInModule
    {
        void Build(ScrubInContext ctx);
    }

    /// <summary>Everything a module needs to find its place in the scene.</summary>
    public class ScrubInContext
    {
        public static ScrubInContext Current { get; private set; }

        /// <summary>The ScrubIn root (world space, identity).</summary>
        public Transform Root;

        /// <summary>The patient frame: X wrist to elbow, Y up, Z toward the thumb, meters. See CLAUDE.md.</summary>
        public Transform PatientRoot;

        /// <summary>At the wound, level, +Z pointing away from the viewer. World-locked once alignment is locked.</summary>
        public Transform Stage;

        /// <summary>Child of Stage: suggested position and tilt for the Attending card.</summary>
        public Transform AttendingAnchor;

        /// <summary>The main camera's transform (the wearer's head).</summary>
        public Transform Head;

        public Camera Camera;

        /// <summary>True when an XR device is driving the camera; false in the desktop preview.</summary>
        public bool IsHeadset;

        public ProcedureData Procedure;

        public PatientAlignment Alignment;

        internal static void SetCurrent(ScrubInContext ctx)
        {
            Current = ctx;
        }
    }

    /// <summary>Warnings worth showing the operator (drawn in the editor legend, never in the headset).</summary>
    public static class ScrubInLog
    {
        static readonly List<string> _warnings = new List<string>();

        public static IList<string> Warnings { get { return _warnings; } }

        public static void Warn(string message)
        {
            if (!_warnings.Contains(message)) _warnings.Add(message);
            Debug.LogWarning("[ScrubIn] " + message);
        }

        public static void Clear()
        {
            _warnings.Clear();
        }
    }
}
