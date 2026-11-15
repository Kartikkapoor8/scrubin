using UnityEngine;

namespace ScrubIn
{
    /// <summary>
    /// Owns where PatientRoot sits in the room. The pose is stored as plain numbers (a pivot at the wound
    /// centre, yaw / pitch / roll, scale) and the transform is rebuilt from them on every change, so repeated
    /// nudges never drift and every rotation turns about the wound rather than about the wrist.
    ///
    /// Two ways to place it:
    ///  - Operator keys nudge it (OperatorInput).
    ///  - Follow mode: it floats where the wearer is looking until it is placed. This is how alignment works on
    ///    the headset with no keyboard: look at the arm, air tap.
    /// </summary>
    public class PatientAlignment : MonoBehaviour
    {
        public const float SpawnDistance = 0.7f;   // meters in front of the head
        public const float SpawnDrop = 0.45f;      // meters below the head
        /// <summary>With no real table found, the virtual table top sits this far below the head.</summary>
        public const float TableBelowHead = 0.75f;
        public const float MinScale = 0.25f;   // "smaller" down to a tabletop model
        public const float MaxScale = 1.6f;

        /// <summary>
        /// While following: a point on a real horizontal surface (spatial mapping) under the wearer's gaze. When set,
        /// the patient sits on it (the table under the arm) instead of floating at a fixed distance.
        /// </summary>
        public Vector3? SurfaceTarget { get; set; }

        // Follow mode keeps the wound on the wearer's line of sight at the same range as the spawn pose
        // (0.7 m ahead and 0.45 m down is 0.83 m away, 33 degrees below level).
        const float FollowDistance = 0.832f;
        const float FollowMinPitch = 15f;
        const float FollowMaxPitch = 65f;
        const float FollowRate = 5f;               // 1/s; higher = snappier, lower = steadier

        static readonly int WorldToPatientId = Shader.PropertyToID("_ScrubInWorldToPatient");

        /// <summary>World position of the wound centre on the skin.</summary>
        public Vector3 PivotWorld { get; private set; }
        public float Yaw { get; private set; }
        public float Pitch { get; private set; }
        public float Roll { get; private set; }
        public float Scale { get; private set; }
        public bool Locked { get; private set; }
        public bool Placed { get; private set; }

        /// <summary>True while the patient frame is following the wearer's gaze.</summary>
        public bool Following { get; private set; }

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
            PivotWorld = _head.position + forward * SpawnDistance + Vector3.down * (TableBelowHead + ForearmShape.TableY * Scale);
            Yaw = Mathf.Atan2(forward.x, forward.z) * Mathf.Rad2Deg;
            Pitch = 0f;
            Roll = 0f;
            Placed = true;
            Apply();
            AimStage(true);
        }

        /// <summary>Turns gaze-following on or off. It cannot be on while alignment is locked.</summary>
        public void SetFollowing(bool on)
        {
            Following = on && !Locked;
        }

        /// <summary>Moves the patient in the wearer's frame, in meters: right, up, away. Ends gaze-following.</summary>
        public void Nudge(float right, float up, float away)
        {
            Following = false;
            Vector3 forward = FlatForward();
            Vector3 rightDir = Vector3.Cross(Vector3.up, forward);
            PivotWorld += rightDir * right + Vector3.up * up + forward * away;
            Apply();
        }

        /// <summary>
        /// Adds to yaw (about vertical), pitch (elbow up) and roll (about the arm's long axis), in degrees.
        /// Ends gaze-following.
        /// </summary>
        public void Rotate(float yaw, float pitch, float roll)
        {
            Following = false;
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

        public void SetScale(float scale)
        {
            Scale = Mathf.Clamp(scale, MinScale, MaxScale);
            Apply();
        }

        /// <summary>Sets the pivot (wound) position and yaw directly (drag to move / rotate). Ends gaze-following.</summary>
        public void SetPivotYaw(Vector3 pivot, float yaw)
        {
            Following = false;
            PivotWorld = pivot;
            Yaw = Mathf.Repeat(yaw + 180f, 360f) - 180f;
            Placed = true;
            Apply();
        }

        public void SetLocked(bool locked)
        {
            if (Locked == locked) return;
            Locked = locked;
            if (locked) Following = false;
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
            if (_head == null) return;

            if (Following && !Locked) FollowGaze();
            PushShaderGlobals();
            if (Placed && !Locked) AimStage(false);
        }

        // Eases the wound toward the point 0.83 m along the wearer's line of sight (never higher than a little
        // below eye level), with the arm lying level across their view.
        void FollowGaze()
        {
            Vector3 flat = FlatForward();
            Vector3 right = Vector3.Cross(Vector3.up, flat);
            float pitchDown = Mathf.Asin(Mathf.Clamp(-_head.forward.y, -1f, 1f)) * Mathf.Rad2Deg;
            float pitch = Mathf.Clamp(pitchDown, FollowMinPitch, FollowMaxPitch);
            Vector3 direction = Quaternion.AngleAxis(pitch, right) * flat;

            // No real table: a virtual table 0.75 m below the head, at the point where the gaze meets it.
            float d = Mathf.Clamp(TableBelowHead / Mathf.Tan(pitch * Mathf.Deg2Rad), 0.55f, 1.4f);
            Vector3 targetPivot = _head.position + flat * d + Vector3.down * (TableBelowHead + ForearmShape.TableY * Scale);
            // A real table under the gaze: rest the arm on it (the wound skin sits -TableY above the table).
            if (SurfaceTarget.HasValue) targetPivot = SurfaceTarget.Value + Vector3.up * (-ForearmShape.TableY * Scale);
            float targetYaw = Mathf.Atan2(flat.x, flat.z) * Mathf.Rad2Deg;

            float k = 1f - Mathf.Exp(-FollowRate * Time.deltaTime);
            PivotWorld = Placed ? Vector3.Lerp(PivotWorld, targetPivot, k) : targetPivot;
            Yaw = Placed ? Mathf.LerpAngle(Yaw, targetYaw, k) : targetYaw;
            Pitch = Mathf.Lerp(Pitch, 0f, k);
            Roll = Mathf.Lerp(Roll, 0f, k);
            Placed = true;
            Apply();
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
