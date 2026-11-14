using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace ScrubIn.EditorTools
{
    /// <summary>
    /// Menu "ScrubIn". Setup Project is safe to run any number of times: it only adds what is missing.
    /// The scene it creates is made through Unity's own API (never hand-written YAML) and holds exactly one
    /// GameObject with ScrubInBootstrap on it.
    /// </summary>
    public static class ScrubInProjectSetup
    {
        const string SceneFolder = "Assets/ScrubIn/Scenes";
        const string ScenePath = SceneFolder + "/ScrubIn.unity";
        const string TmpSettingsPath = "Assets/TextMesh Pro/Resources/TMP Settings.asset";
        const string TmpImportMenu = "Window/TextMeshPro/Import TMP Essential Resources";

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
            EnsureIdentity();
            EnsureCapabilities();
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
        // project starts on Standalone even with the rig's settings. Holographic Remoting needs UWP active.
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

        [MenuItem("ScrubIn/Check HoloLens Settings", false, 20)]
        public static void ReportSettings()
        {
            Line(EditorUserBuildSettings.activeBuildTarget == BuildTarget.WSAPlayer,
                "Build target is Universal Windows Platform",
                "Build target is " + EditorUserBuildSettings.activeBuildTarget
                + ". Run ScrubIn > Switch Platform to UWP (HoloLens); Holographic Remoting needs it.");

            Line(PlayerSettings.WSA.GetCapability(PlayerSettings.WSACapability.SpatialPerception)
                 && PlayerSettings.WSA.GetCapability(PlayerSettings.WSACapability.Microphone)
                 && PlayerSettings.WSA.GetCapability(PlayerSettings.WSACapability.InternetClient),
                "UWP capabilities: SpatialPerception, Microphone, InternetClient",
                "UWP capabilities are missing one of SpatialPerception / Microphone / InternetClient.");

            Line(File.Exists(TmpSettingsPath),
                "TextMeshPro essentials are imported",
                "TextMeshPro essentials are not imported: labels will be hidden. Window > TextMeshPro > Import TMP Essential Resources.");

            Line(Shader.Find("ScrubIn/HoloGlow") != null,
                "ScrubIn/HoloGlow shader found",
                "ScrubIn/HoloGlow shader not found: check the Console for a shader compile error.");

            Line(File.Exists(ScenePath),
                "Demo scene exists at " + ScenePath,
                "Demo scene missing. Run ScrubIn > Setup Project.");

            Debug.Log("[ScrubIn] Stereo rendering: " + PlayerSettings.stereoRenderingPath
                      + "   Color space: " + PlayerSettings.colorSpace
                      + "\nXR itself (Virtual Reality Supported + Windows Mixed Reality in the SDK list) is under "
                      + "Project Settings > Player > XR Settings. The operator legend shows HEADSET when it is working. "
                      + "Full list: docs/SETUP_WINDOWS.md.");
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

        // The project settings are copied from another project (the rig). Rename the app so that a device
        // build installs as ScrubIn instead of replacing the rig's app on the HoloLens.
        static void EnsureIdentity()
        {
            if (PlayerSettings.productName != "ScrubIn") PlayerSettings.productName = "ScrubIn";
            if (PlayerSettings.WSA.packageName != "ScrubIn") PlayerSettings.WSA.packageName = "ScrubIn";
        }

        static void EnsureCapabilities()
        {
            PlayerSettings.WSA.SetCapability(PlayerSettings.WSACapability.SpatialPerception, true);
            PlayerSettings.WSA.SetCapability(PlayerSettings.WSACapability.Microphone, true);
            PlayerSettings.WSA.SetCapability(PlayerSettings.WSACapability.InternetClient, true);
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
