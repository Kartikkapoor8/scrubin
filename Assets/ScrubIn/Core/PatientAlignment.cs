using UnityEngine;

namespace ScrubIn
{
    /// <summary>
    /// Owns where PatientRoot sits in the room. The pose is stored as plain numbers (a pivot at the wound
    /// centre, yaw / pitch / roll, scale) and the transform is rebuilt from them on every change, so repeated
    /// nudges never drift and every rotation turns about the wound rather than about the wrist.
    /// </summary>
    public class PatientAlignment : MonoBehaviour
    {
        public const float SpawnDistance = 0.7f;   // meters in front of the head
        public const float SpawnDrop = 0.45f;      // meters below the head
        public const float MinScale = 0.7f;
        public const float MaxScale = 1.4f;

        static readonly int WorldToPatientId = Shader.PropertyToID("_ScrubInWorldToPatient");

        /// <summary>World position of the wound centre on the skin.</summary>
        public Vector3 PivotWorld { get; private set; }
        public float Yaw { get; private set; }
        public float Pitch { get; private set; }
        public float Roll { get; private set; }
        public float Scale { get; private set; }
        public bool Locked { get; private set; }
        public bool Placed { get; private set; }

        Transform _head;
        Transform _stage;
        Vector3 _pivotLocal;

        public void Init(Transform head, Transform stage, Vector3 pivotLocal)
        {
            _head = head;
            _stage = stage;
            _pivotLocal = pivotLocal;
            Scale = 1f;
            Apply();
        }

        /// <summary>The wearer's forward direction flattened onto the floor plane.</summary>
        public Vector3 FlatForward()
        {
            Vector3 f = Vector3.ProjectOnPlane(_head.forward, Vector3.up);
            if (f.sqrMagnitude < 0.04f)
            {
                // Looking almost straight down (or up): the top of the head points where "forward" is.
                f = Vector3.ProjectOnPlane(_head.forward.y < 0f ? _head.up : -_head.up, Vector3.up);
            }
            if (f.sqrMagnitude < 1e-6f) f = Vector3.forward;
            return f.normalized;
        }

        /// <summary>
        /// Puts the wound 0.7 m in front of and 0.45 m below the head, facing the wearer: the arm lies across
        /// their view with the wrist on their left, the elbow on their right and the thumb side away from them.
        /// Scale is kept; tilt is cleared.
        /// </summary>
        public void PlaceInFrontOfHead()
        {
            Vector3 forward = FlatForward();
            PivotWorld = _head.position + forward * SpawnDistance + Vector3.down * SpawnDrop;
            Yaw = Mathf.Atan2(forward.x, forward.z) * Mathf.Rad2Deg;
            Pitch = 0f;
            Roll = 0f;
            Placed = true;
            Apply();
            AimStage(true);
        }

        /// <summary>Moves the patient in the wearer's frame, in meters: right, up, away.</summary>
        public void Nudge(float right, float up, float away)
        {
            Vector3 forward = FlatForward();
            Vector3 rightDir = Vector3.Cross(Vector3.up, forward);
            PivotWorld += rightDir * right + Vector3.up * up + forward * away;
            Apply();
        }

        /// <summary>Adds to yaw (about vertical), pitch (elbow up) and roll (about the arm's long axis), in degrees.</summary>
        public void Rotate(float yaw, float pitch, float roll)
        {
            Yaw = Mathf.Repeat(Yaw + yaw + 180f, 360f) - 180f;
            Pitch = Mathf.Clamp(Pitch + pitch, -45f, 45f);
            Roll = Mathf.Clamp(Roll + roll, -60f, 60f);
            Apply();
        }

        public void ScaleBy(float factor)
        {
            Scale = Mathf.Clamp(Scale * factor, MinScale, MaxScale);
            Apply();
        }

        public void SetLocked(bool locked)
        {
            if (Locked == locked) return;
            Locked = locked;
            AimStage(true);
            ScrubInEvents.RaiseAlignmentLocked(locked);
        }

        public void ToggleLocked()
        {
            SetLocked(!Locked);
        }

        void Apply()
        {
            Quaternion rotation = Quaternion.AngleAxis(Yaw, Vector3.up)
                                  * Quaternion.AngleAxis(Pitch, Vector3.forward)
                                  * Quaternion.AngleAxis(Roll, Vector3.right);
            transform.localScale = Vector3.one * Scale;
            transform.rotation = rotation;
            transform.position = PivotWorld - rotation * (_pivotLocal * Scale);
            PushShaderGlobals();
        }

        void LateUpdate()
        {
            PushShaderGlobals();
            if (Placed && !Locked) AimStage(false);
        }

        // HoloGlow uses this to run reveal wipes in patient space.
        void PushShaderGlobals()
        {
            Shader.SetGlobalMatrix(WorldToPatientId, transform.worldToLocalMatrix);
        }

        // The stage sits at the wound and faces the wearer. It follows them while alignment is unlocked and
        // is frozen on lock, so cards parented to it stay world-locked for the rest of the demo.
        void AimStage(bool immediate)
        {
            if (_stage == null || _head == null) return;
            _stage.position = PivotWorld;

            Vector3 away = Vector3.ProjectOnPlane(PivotWorld - _head.position, Vector3.up);
            if (away.sqrMagnitude < 0.01f) return;   // standing right over it: keep the last facing

            Quaternion target = Quaternion.LookRotation(away.normalized, Vector3.up);
            _stage.rotation = immediate
                ? target
                : Quaternion.Slerp(_stage.rotation, target, 1f - Mathf.Exp(-4f * Time.deltaTime));
        }
    }
}
