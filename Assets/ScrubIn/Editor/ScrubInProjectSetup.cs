using System;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using Object = UnityEngine.Object;

namespace ScrubIn.EditorTools
{
    /// <summary>
    /// Menu "ScrubIn". The one setup path for every machine. Everything here is safe to run any number of times.
    ///
    /// Setup Project: scene, shader, identity, TMP essentials, plus every HoloLens 1 setting from
    /// docs/SETUP_WINDOWS.md section B (via ApplyHoloLensSettings).
    /// The scene it creates is made through Unity's own API (never hand-written YAML) and holds exactly one
    /// GameObject with ScrubInBootstrap on it.
    ///
    /// Unity 2019.4, legacy built-in XR. Calls marked [DEPRECATED-BUT-WORKS] are flagged obsolete since 2019.3
    /// (Unity wants XR Plug-in Management) but still work in 2019.4, and the legacy path is what HoloLens 1 and
    /// Holographic Emulation remoting need. Their obsolete warnings are suppressed locally with pragma 618.
    /// Owner: Windows laptop agent (with BuildScript.cs and tools/).
    /// </summary>
    public static class ScrubInProjectSetup
    {
        public const string ProductName = "VIPER";

        const string SceneFolder = "Assets/ScrubIn/Scenes";
        const string ScenePath = SceneFolder + "/ScrubIn.unity";
        const string TmpSettingsPath = "Assets/TextMesh Pro/Resources/TMP Settings.asset";
        const string TmpImportMenu = "Window/TextMeshPro/Import TMP Essential Resources";

        // Quality: the editor renders during Holographic Remoting (PC GPU), so it gets 4x MSAA. A device build
        // renders on the HoloLens 1 GPU, so it gets a cheaper level with no MSAA.
        const string EditorQualityLevel = "High";
        const string DeviceQualityLevel = "Medium";
        const string WsaPlatformName = "Windows Store Apps";
        const string StandalonePlatformName = "Standalone";

        static readonly PlayerSettings.WSACapability[] Capabilities =
        {
            PlayerSettings.WSACapability.SpatialPerception,
            PlayerSettings.WSACapability.Microphone,
            PlayerSettings.WSACapability.InternetClient,
            PlayerSettings.WSACapability.InternetClientServer,
            PlayerSettings.WSACapability.PrivateNetworkClientServer,
        };

        [MenuItem("ScrubIn/Setup Project", false, 0)]
        public static void SetupProject()
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode)
            {
                Debug.LogWarning("[ScrubIn] Stop Play mode before running Setup Project.");
                return;
            }

            EnsureScene();
            EnsureShaderAlwaysIncluded();
            ApplyHoloLensSettings();
            AssetDatabase.SaveAssets();
            ReportSettings();
            EnsureTextMeshProResources();   // last: importing a package is finished by Unity after this returns
        }

        [MenuItem("ScrubIn/Open Demo Scene", false, 1)]
        public static void OpenScene()
        {
            if (!File.Exists(ScenePath))
            {
                Debug.LogWarning("[ScrubIn] " + ScenePath + " does not exist yet. Run ScrubIn > Setup Project.");
                return;
            }
            if (EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
            {
                EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
            }
        }

        // The active platform is stored per machine (in Library/), not in ProjectSettings, so a freshly opened
        // project starts on Standalone even with the committed settings. Holographic Remoting needs UWP active.
        [MenuItem("ScrubIn/Switch Platform to UWP (HoloLens)", false, 2)]
        public static void SwitchToUwp()
        {
            if (EditorUserBuildSettings.activeBuildTarget == BuildTarget.WSAPlayer)
            {
                Debug.Log("[ScrubIn] The build target is already Universal Windows Platform.");
                return;
            }
            if (!EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.WSA, BuildTarget.WSAPlayer))
            {
                Debug.LogWarning("[ScrubIn] Could not switch to Universal Windows Platform. Is the UWP build support "
                                 + "module installed for this Unity version (Unity Hub > Installs > Add modules)?");
            }
        }

        /// <summary>
        /// Every HoloLens 1 build/XR/player setting from docs/SETUP_WINDOWS.md section B. No dialogs, no scene
        /// changes, so BuildScript calls it before every build (the per-machine Build Settings live in Library/
        /// and are not shared through git).
        /// </summary>
        [MenuItem("ScrubIn/Apply HoloLens Settings", false, 3)]
        public static void ApplyHoloLensSettings()
        {
            const BuildTargetGroup wsa = BuildTargetGroup.WSA;

            // File > Build Settings (per machine).
            SwitchToUwp();
            EditorUserBuildSettings.wsaSubtarget = WSASubtarget.HoloLens;
            EditorUserBuildSettings.wsaUWPBuildType = WSAUWPBuildType.D3D;
            EditorUserBuildSettings.wsaMinUWPSDK = "10.0.10240.0";
            // Pinned, not "Latest installed": Unity references the WindowsMobile extension SDK, which SDK 10.0.26100
            // no longer ships (MSB3774). 10.0.19041 comes with VS 2019 Build Tools and has it.
            EditorUserBuildSettings.wsaUWPSDK = "10.0.19041.0";
            // Pinned, not "Latest installed": with VS 2026 Build Tools also on the laptop, Unity generated v143
            // projects that VS 2019 Build Tools cannot compile. (tools\build.ps1 also forces the toolset.)
            EditorUserBuildSettings.wsaUWPVisualStudioVersion = "Visual Studio 2019";
            SetWsaArchitecture("x86");

            // Player > Other Settings.
            PlayerSettings.SetScriptingBackend(wsa, ScriptingImplementation.IL2CPP);
            PlayerSettings.SetApiCompatibilityLevel(wsa, ApiCompatibilityLevel.NET_Standard_2_0);
            PlayerSettings.colorSpace = ColorSpace.Linear;   // the HoloGlow shader assumes Linear
            PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.WSAPlayer, true);

#pragma warning disable 618
            // Player > XR Settings.
            PlayerSettings.SetVirtualRealitySupported(wsa, true);                                         // [DEPRECATED-BUT-WORKS]
            UnityEditorInternal.VR.VREditor.SetVREnabledDevicesOnTargetGroup(wsa, new[] { "WindowsMR" }); // [DEPRECATED-BUT-WORKS]
            PlayerSettings.VRWindowsMixedReality.depthBufferFormat =
                PlayerSettings.VRWindowsMixedReality.DepthBufferFormat.DepthBufferFormat16Bit;            // [DEPRECATED-BUT-WORKS]
            PlayerSettings.VRWindowsMixedReality.depthBufferSharingEnabled = true;                        // [DEPRECATED-BUT-WORKS]
            PlayerSettings.stereoRenderingPath = StereoRenderingPath.Instancing;
#pragma warning restore 618

            // Player > Publishing Settings.
            EnsureIdentity();
            foreach (var c in Capabilities) PlayerSettings.WSA.SetCapability(c, true);
            PlayerSettings.WSA.SetTargetDeviceFamily(PlayerSettings.WSATargetFamily.Holographic, true);

            // Project Settings > Quality.
            EnsureQualityLevels();

            AssetDatabase.SaveAssets();
            Debug.Log("[ScrubIn] Applied HoloLens 1 settings (UWP / HoloLens / x86 / D3D, VR WindowsMR, depth 16-bit shared, "
                      + "single-pass instanced, IL2CPP, .NET Standard 2.0, Linear, 5 capabilities, Holographic family, "
                      + "editor quality '" + EditorQualityLevel + "' 4x MSAA, device quality '" + DeviceQualityLevel + "' no MSAA).");
        }

        [MenuItem("ScrubIn/Check HoloLens Settings", false, 20)]
        public static void ReportSettings()
        {
            const BuildTargetGroup wsa = BuildTargetGroup.WSA;

            Line(EditorUserBuildSettings.activeBuildTarget == BuildTarget.WSAPlayer,
                "Build target is Universal Windows Platform",
                "Build target is " + EditorUserBuildSettings.activeBuildTarget
                + ". Run ScrubIn > Switch Platform to UWP (HoloLens); Holographic Remoting needs it.");

            Line(EditorUserBuildSettings.wsaSubtarget == WSASubtarget.HoloLens
                 && EditorUserBuildSettings.wsaUWPBuildType == WSAUWPBuildType.D3D,
                "UWP build: HoloLens, D3D",
                "UWP build settings are not HoloLens / D3D. Run ScrubIn > Apply HoloLens Settings.");

#pragma warning disable 618
            bool vr = PlayerSettings.GetVirtualRealitySupported(wsa);                                     // [DEPRECATED-BUT-WORKS]
            string[] sdks = UnityEditorInternal.VR.VREditor.GetVREnabledDevicesOnTargetGroup(wsa);       // [DEPRECATED-BUT-WORKS]
            bool depthShared = PlayerSettings.VRWindowsMixedReality.depthBufferSharingEnabled;           // [DEPRECATED-BUT-WORKS]
#pragma warning restore 618
            Line(vr && Array.IndexOf(sdks, "WindowsMR") >= 0,
                "XR: Virtual Reality Supported, Windows Mixed Reality",
                "XR is off or Windows Mixed Reality is not in the SDK list. Run ScrubIn > Apply HoloLens Settings.");
            Line(depthShared && PlayerSettings.stereoRenderingPath == StereoRenderingPath.Instancing,
                "XR: depth buffer sharing, single-pass instanced",
                "Depth buffer sharing or single-pass instanced is off. Run ScrubIn > Apply HoloLens Settings.");

            Line(PlayerSettings.colorSpace == ColorSpace.Linear,
                "Color space: Linear",
                "Color space is " + PlayerSettings.colorSpace + "; the team uses Linear.");

            bool caps = true;
            foreach (var c in Capabilities) caps &= PlayerSettings.WSA.GetCapability(c);
            Line(caps,
                "UWP capabilities: SpatialPerception, Microphone, InternetClient, InternetClientServer, PrivateNetworkClientServer",
                "A UWP capability is missing. Run ScrubIn > Apply HoloLens Settings.");

            Line(PlayerSettings.productName == ProductName && PlayerSettings.WSA.packageName == ProductName,
                "App identity: " + ProductName,
                "Product / package name is not " + ProductName + ".");

            Line(QualitySettings.antiAliasing == 4,
                "Editor quality '" + QualitySettings.names[QualitySettings.GetQualityLevel()] + "': 4x MSAA",
                "Editor quality level '" + QualitySettings.names[QualitySettings.GetQualityLevel()] + "' has "
                + QualitySettings.antiAliasing + "x MSAA; expected 4x. Run ScrubIn > Apply HoloLens Settings.");

            Line(File.Exists(TmpSettingsPath),
                "TextMeshPro essentials are imported",
                "TextMeshPro essentials are not imported: labels will be hidden. Window > TextMeshPro > Import TMP Essential Resources.");

            Line(Shader.Find("ScrubIn/HoloGlow") != null,
                "ScrubIn/HoloGlow shader found",
                "ScrubIn/HoloGlow shader not found: check the Console for a shader compile error.");

            Line(File.Exists(ScenePath),
                "Demo scene exists at " + ScenePath,
                "Demo scene missing. Run ScrubIn > Setup Project.");
        }

        static void Line(bool ok, string good, string bad)
        {
            if (ok) Debug.Log("[ScrubIn] OK    " + good);
            else Debug.LogWarning("[ScrubIn] TODO  " + bad);
        }

        // One scene, one GameObject, one component. Everything else is built by ScrubInBootstrap at Start.
        static void EnsureScene()
        {
            if (!File.Exists(ScenePath))
            {
                if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;

                Directory.CreateDirectory(SceneFolder);
                Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                GameObject root = new GameObject("ScrubIn");
                root.AddComponent<ScrubInBootstrap>();
                EditorSceneManager.SaveScene(scene, ScenePath);
                AssetDatabase.Refresh();
                Debug.Log("[ScrubIn] Created " + ScenePath + ". Commit it together with its .meta file.");
            }
            else if (SceneManager.GetActiveScene().path != ScenePath)
            {
                if (EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo())
                {
                    EditorSceneManager.OpenScene(ScenePath, OpenSceneMode.Single);
                }
            }

            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
        }

        // Shader.Find only works in a device build if the shader is referenced by something or listed here.
        // (Holographic Remoting runs in the editor, where this does not matter.)
        static void EnsureShaderAlwaysIncluded()
        {
            Shader shader = Shader.Find("ScrubIn/HoloGlow");
            if (shader == null) return;

            Object[] settings = AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/GraphicsSettings.asset");
            if (settings == null || settings.Length == 0) return;

            SerializedObject graphics = new SerializedObject(settings[0]);
            SerializedProperty shaders = graphics.FindProperty("m_AlwaysIncludedShaders");
            if (shaders == null || !shaders.isArray) return;

            for (int i = 0; i < shaders.arraySize; i++)
            {
                if (shaders.GetArrayElementAtIndex(i).objectReferenceValue == shader) return;
            }

            int index = shaders.arraySize;
            shaders.InsertArrayElementAtIndex(index);
            shaders.GetArrayElementAtIndex(index).objectReferenceValue = shader;
            graphics.ApplyModifiedProperties();
            Debug.Log("[ScrubIn] Added ScrubIn/HoloGlow to Graphics > Always Included Shaders.");
        }

        // The app installs on the HoloLens as VIPER (repo, folders and namespaces stay ScrubIn).
        static void EnsureIdentity()
        {
            if (PlayerSettings.productName != ProductName) PlayerSettings.productName = ProductName;
            if (PlayerSettings.WSA.packageName != ProductName) PlayerSettings.WSA.packageName = ProductName;
        }

        // EditorUserBuildSettings.wsaArchitecture is not public on every 2019.4 patch: use it if present,
        // otherwise write the per-platform setting the Build Settings window uses. (The generated IL2CPP
        // solution contains every architecture either way; tools\build.ps1 builds Release|x86.)
        static void SetWsaArchitecture(string arch)
        {
            var prop = typeof(EditorUserBuildSettings).GetProperty("wsaArchitecture",
                System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static);
            if (prop != null && prop.CanWrite) { prop.SetValue(null, arch, null); return; }
            EditorUserBuildSettings.SetPlatformSettings("WindowsStoreApps", "Architecture", arch);
        }

        // Editor level: 4x MSAA, no VSync (remoting, PC GPU). Device level: no MSAA, full-res textures (TMP atlases
        // must not be downscaled), no shadows (HoloLens 1 GPU). There is no public API for per-platform defaults
        // or for editing a level other than the current one, so this edits QualitySettings.asset directly.
        static void EnsureQualityLevels()
        {
            int editorIdx = Array.IndexOf(QualitySettings.names, EditorQualityLevel);
            int deviceIdx = Array.IndexOf(QualitySettings.names, DeviceQualityLevel);
            if (editorIdx < 0) editorIdx = QualitySettings.names.Length - 1;
            if (deviceIdx < 0) deviceIdx = Math.Max(0, editorIdx - 1);

            Object[] assets = AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/QualitySettings.asset");
            if (assets == null || assets.Length == 0)
            {
                Debug.LogWarning("[ScrubIn] QualitySettings.asset not found; quality unchanged.");
                return;
            }
            SerializedObject so = new SerializedObject(assets[0]);
            SerializedProperty levels = so.FindProperty("m_QualitySettings");
            if (levels != null && levels.isArray)
            {
                SetInt(levels, editorIdx, "antiAliasing", 4);
                SetInt(levels, editorIdx, "vSyncCount", 0);
                SetInt(levels, deviceIdx, "antiAliasing", 0);
                SetInt(levels, deviceIdx, "textureQuality", 0);
                SetInt(levels, deviceIdx, "shadows", 0);
            }
            SetPlatformDefault(so, WsaPlatformName, deviceIdx);
            SetPlatformDefault(so, StandalonePlatformName, editorIdx);
            so.ApplyModifiedPropertiesWithoutUndo();

            // The editor (and therefore remoting) renders with the current level.
            QualitySettings.SetQualityLevel(editorIdx, true);
        }

        static void SetInt(SerializedProperty levels, int index, string field, int value)
        {
            if (index < 0 || index >= levels.arraySize) return;
            SerializedProperty p = levels.GetArrayElementAtIndex(index).FindPropertyRelative(field);
            if (p != null) p.intValue = value;
        }

        static void SetPlatformDefault(SerializedObject so, string platform, int index)
        {
            SerializedProperty map = so.FindProperty("m_PerPlatformDefaultQuality");
            if (map == null || !map.isArray) return;
            for (int i = 0; i < map.arraySize; i++)
            {
                SerializedProperty pair = map.GetArrayElementAtIndex(i);
                if (pair.FindPropertyRelative("first").stringValue == platform)
                {
                    pair.FindPropertyRelative("second").intValue = index;
                    return;
                }
            }
            map.InsertArrayElementAtIndex(map.arraySize);
            SerializedProperty added = map.GetArrayElementAtIndex(map.arraySize - 1);
            added.FindPropertyRelative("first").stringValue = platform;
            added.FindPropertyRelative("second").intValue = index;
        }

        // TextMeshPro needs its font, settings and shaders copied into Assets once per project.
        static void EnsureTextMeshProResources()
        {
            if (File.Exists(TmpSettingsPath)) return;

            // The same file TMP's own importer uses. Unity resolves "Packages/<name>" to the package's real folder.
            string package = Path.GetFullPath("Packages/com.unity.textmeshpro")
                             + "/Package Resources/TMP Essential Resources.unitypackage";
            if (File.Exists(package))
            {
                AssetDatabase.ImportPackage(package, false);
                Debug.Log("[ScrubIn] Importing TextMeshPro essentials. When it finishes, commit the new "
                          + "'Assets/TextMesh Pro' folder so the team shares it.");
            }
            else if (EditorApplication.ExecuteMenuItem(TmpImportMenu))
            {
                Debug.Log("[ScrubIn] TextMeshPro's import window opened: click Import, then commit the new "
                          + "'Assets/TextMesh Pro' folder so the team shares it.");
            }
            else
            {
                Debug.LogWarning("[ScrubIn] Could not import the TextMeshPro essentials. Do it by hand: "
                                 + TmpImportMenu.Replace("/", " > ") + ". If that menu does not exist, add the "
                                 + "TextMeshPro package in Window > Package Manager first.");
            }
        }
    }
}
