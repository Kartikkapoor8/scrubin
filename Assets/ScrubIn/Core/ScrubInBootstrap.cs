using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using UnityEngine;
using UnityEngine.XR;

namespace ScrubIn
{
    /// <summary>
    /// The one component in the scene. Builds the whole experience from code at Start, so the scene file never
    /// changes and three people can work without merge conflicts.
    /// Features plug in by implementing IScrubInModule (see CLAUDE.md); do not add them here.
    /// </summary>
    [DefaultExecutionOrder(-1000)]
    public class ScrubInBootstrap : MonoBehaviour
    {
        /// <summary>Height of the stand-in "head" in the no-headset editor preview: standing eye height.</summary>
        public const float PreviewEyeHeight = 1.6f;

        static ScrubInBootstrap _instance;

        ScrubInContext _ctx;
        DesktopPreviewCamera _preview;
        bool _placing;

        // Safety net: if the open scene has no bootstrap in it (new scene, wrong scene, broken scene file),
        // make one, so pressing Play always runs the demo.
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void EnsureBootstrap()
        {
            if (FindObjectOfType<ScrubInBootstrap>() != null) return;
            new GameObject("ScrubIn").AddComponent<ScrubInBootstrap>();
        }

        void Awake()
        {
            if (_instance != null && _instance != this)
            {
                enabled = false;
                Destroy(gameObject);
                return;
            }
            _instance = this;

            // Statics outlive a Play session when domain reload is off, so start every run clean.
            ScrubInEvents.ClearAll();
            ScrubInLog.Clear();
            HoloMaterials.ResetCache();
            LabelBuilder.ResetCache();
        }

        IEnumerator Start()
        {
            // If XR is switched on, give the headset a moment to come up before deciding between headset
            // and desktop preview. (If it shows up later still, Update switches over.)
            float waited = 0f;
            while (XRSettings.enabled && !XRSettings.isDeviceActive && waited < 0.6f)
            {
                waited += Time.unscaledDeltaTime;
                yield return null;
            }

            try
            {
                Build();
            }
            catch (Exception e)
            {
                ScrubInLog.Warn("Bootstrap failed: " + e.Message + " (full error in the Console)");
                Debug.LogException(e);
            }
        }

        void Update()
        {
            // The headset connected after Play was pressed: hand the camera over to it and re-place the patient.
            if (_ctx == null || _ctx.IsHeadset || _placing) return;
            if (XRSettings.enabled && XRSettings.isDeviceActive)
            {
                _ctx.IsHeadset = true;
                if (_preview != null)
                {
                    Destroy(_preview);
                    _preview = null;
                }
                StartCoroutine(PlaceWhenReady());
            }
        }

        void Build()
        {
            transform.SetParent(null, false);
            transform.position = Vector3.zero;
            transform.rotation = Quaternion.identity;
            transform.localScale = Vector3.one;

            Camera cam = SetUpCamera();
            bool headset = XRSettings.enabled && XRSettings.isDeviceActive;

            // HoloGlow reads "1 - dim", so a value that was never set still means fully visible.
            Shader.SetGlobalFloat(HoloProps.GlobalDim, 0f);

            Transform patientRoot = NewChild("PatientRoot", transform);
            Transform stage = NewChild("Stage", transform);
            Transform attendingAnchor = NewChild("AttendingAnchor", stage);
            // Right of and above the wound, tipped back about 30 degrees so it faces the wearer's eyes.
            attendingAnchor.localPosition = new Vector3(0.13f, 0.10f, 0.05f);
            attendingAnchor.localRotation = Quaternion.Euler(30f, 0f, 0f);

            ProcedureData procedure = ProcedureData.Load();

            PatientAlignment alignment = patientRoot.gameObject.AddComponent<PatientAlignment>();
            alignment.Init(cam.transform, stage, ForearmShape.Surface(procedure.wound.CenterX, procedure.wound.z));

            _ctx = new ScrubInContext();
            _ctx.Root = transform;
            _ctx.PatientRoot = patientRoot;
            _ctx.Stage = stage;
            _ctx.AttendingAnchor = attendingAnchor;
            _ctx.Head = cam.transform;
            _ctx.Camera = cam;
            _ctx.IsHeadset = headset;
            _ctx.Procedure = procedure;
            _ctx.Alignment = alignment;
            ScrubInContext.SetCurrent(_ctx);

            if (!headset)
            {
                cam.transform.SetParent(null, false);
                cam.transform.position = new Vector3(0f, PreviewEyeHeight, 0f);
                cam.transform.rotation = Quaternion.identity;
                cam.fieldOfView = 26f;   // a little wider than the HoloLens view (17.5 degrees tall)
                _preview = cam.gameObject.AddComponent<DesktopPreviewCamera>();
                _preview.Init(alignment);
            }

            // Operator input first, so its legend can show a warning if anything below fails.
            HoloInput holoInput = gameObject.AddComponent<HoloInput>();
            holoInput.Init(_ctx);
            OperatorInput input = gameObject.AddComponent<OperatorInput>();
            input.Init(this, _ctx, holoInput);

            // The headset shows only the holographic body (Body/BodyInteraction, an IScrubInModule). The old arm
            // outline is no longer built: its hologram wound line is green, and the Mac tracks a green marker.
            BuildModules();

            StartCoroutine(PlaceWhenReady());
        }

        Camera SetUpCamera()
        {
            Camera cam = Camera.main;
            if (cam == null) cam = FindObjectOfType<Camera>();
            if (cam == null)
            {
                GameObject go = new GameObject("Main Camera");
                go.tag = "MainCamera";
                cam = go.AddComponent<Camera>();
            }

            // Black is transparent on the HoloLens: clear to (0,0,0,0) and nothing but holograms shows.
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0f, 0f, 0f, 0f);
            cam.nearClipPlane = 0.1f;
            cam.farClipPlane = 20f;

            if (FindObjectOfType<AudioListener>() == null) cam.gameObject.AddComponent<AudioListener>();
            return cam;
        }

        IEnumerator PlaceWhenReady()
        {
            _placing = true;
            if (_ctx.IsHeadset)
            {
                // The first frames of a remoting session can still carry a stale head pose. Wait for a real one
                // before measuring "in front of the wearer".
                float waited = 0f;
                while (waited < 0.75f)
                {
                    waited += Time.unscaledDeltaTime;
                    yield return null;
                }
            }
            else
            {
                yield return null;
            }

            Recenter();
            _placing = false;

            // Announce the alignment state (it starts unlocked), which also brings the outline in.
            ScrubInEvents.RaiseAlignmentLocked(_ctx.Alignment.Locked);
        }

        /// <summary>
        /// Operator key C. Headset: puts the outline back in front of the wearer (and lets it follow their gaze
        /// again). Editor preview: also puts the camera back at standing eye height looking down at the arm.
        /// A locked alignment is never moved.
        /// </summary>
        public void Recenter()
        {
            if (_ctx == null) return;
            PatientAlignment alignment = _ctx.Alignment;

            if (_preview != null)
            {
                Vector3 eye = new Vector3(0f, PreviewEyeHeight, 0f);
                if (!alignment.Locked)
                {
                    _ctx.Head.position = eye;
                    _ctx.Head.rotation = Quaternion.identity;
                    alignment.PlaceInFrontOfHead();
                }
                _preview.Frame(eye);
            }
            else if (!alignment.Locked)
            {
                alignment.PlaceInFrontOfHead();
                alignment.SetFollowing(_ctx.Procedure.options.followGazeUntilPlaced);
            }
        }

        // Finds every IScrubInModule in the project and builds it. A module that throws is reported and
        // skipped; it cannot stop the others.
        void BuildModules()
        {
            Type[] types;
            try
            {
                types = typeof(ScrubInBootstrap).Assembly.GetTypes();
            }
            catch (ReflectionTypeLoadException e)
            {
                types = e.Types;
            }

            List<Type> moduleTypes = new List<Type>();
            for (int i = 0; i < types.Length; i++)
            {
                Type t = types[i];
                if (t == null || t.IsAbstract || t.IsInterface) continue;
                if (typeof(IScrubInModule).IsAssignableFrom(t)) moduleTypes.Add(t);
            }
            moduleTypes.Sort((a, b) => string.CompareOrdinal(a.FullName, b.FullName));

            for (int i = 0; i < moduleTypes.Count; i++)
            {
                Type t = moduleTypes[i];
                try
                {
                    IScrubInModule module;
                    if (typeof(MonoBehaviour).IsAssignableFrom(t))
                    {
                        module = (IScrubInModule)NewChild(t.Name, transform).gameObject.AddComponent(t);
                    }
                    else
                    {
                        module = (IScrubInModule)Activator.CreateInstance(t);
                    }
                    module.Build(_ctx);
                }
                catch (Exception e)
                {
                    ScrubInLog.Warn("Module " + t.Name + " failed to build and was skipped: " + e.Message);
                    Debug.LogException(e);
                }
            }
        }

        static Transform NewChild(string name, Transform parent)
        {
            GameObject go = new GameObject(name);
            go.transform.SetParent(parent, false);
            return go.transform;
        }

        void OnDestroy()
        {
            if (_instance == this) _instance = null;
        }
    }
}
