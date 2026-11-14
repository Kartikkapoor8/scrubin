using UnityEngine;

namespace ScrubIn
{
    /// <summary>
    /// Stand-in for the wearer's head when no headset is connected, so anyone can work on the holograms from
    /// the editor. Orbits the wound: right-drag to look around, scroll to move in and out.
    /// Only added when no XR device is active; with a headset the device drives the camera.
    /// </summary>
    public class DesktopPreviewCamera : MonoBehaviour
    {
        PatientAlignment _alignment;
        float _yaw;
        float _pitch = 33f;
        float _distance = 0.83f;
        Vector3 _lastMouse;

        public void Init(PatientAlignment alignment)
        {
            _alignment = alignment;
        }

        /// <summary>Look at the wound from <c>eye</c>.</summary>
        public void Frame(Vector3 eye)
        {
            Vector3 to = _alignment.PivotWorld - eye;
            _distance = Mathf.Max(to.magnitude, 0.12f);
            _yaw = Mathf.Atan2(to.x, to.z) * Mathf.Rad2Deg;
            _pitch = Mathf.Asin(Mathf.Clamp(-to.y / _distance, -1f, 1f)) * Mathf.Rad2Deg;
            Place();
        }

        void LateUpdate()
        {
            if (_alignment == null) return;

            // Mouse deltas are measured by hand so this does not depend on the Input Manager's axis setup.
            Vector3 mouse = Input.mousePosition;
            if (Input.GetMouseButtonDown(1)) _lastMouse = mouse;
            if (Input.GetMouseButton(1))
            {
                Vector3 delta = mouse - _lastMouse;
                _yaw += delta.x * 0.25f;
                _pitch = Mathf.Clamp(_pitch - delta.y * 0.25f, 2f, 89f);
            }
            _lastMouse = mouse;

            float scroll = Input.mouseScrollDelta.y;
            if (scroll != 0f) _distance = Mathf.Clamp(_distance * (1f - scroll * 0.1f), 0.12f, 3f);

            Place();
        }

        void Place()
        {
            Quaternion rotation = Quaternion.Euler(_pitch, _yaw, 0f);
            transform.rotation = rotation;
            transform.position = _alignment.PivotWorld - rotation * Vector3.forward * _distance;
        }
    }
}
