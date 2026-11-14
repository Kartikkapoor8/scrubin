using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace ScrubIn.EditorTools
{
    /// <summary>
    /// Menu "ScrubIn/Build HoloLens (x86)". Writes the UWP Visual Studio solution for HoloLens 1 to C:\b\scrubin
    /// (short path: UWP builds hit the 260-char limit). tools\build.ps1 then compiles it with MSBuild into an .appx.
    ///
    /// Batch mode (what tools\build.ps1 runs; the project must NOT be open in the Editor):
    ///   Unity.exe -batchmode -quit -projectPath C:\dev\scrubin -buildTarget WSAPlayer -logFile &lt;log&gt;
    ///     -executeMethod ScrubIn.EditorTools.BuildScript.BuildBatch [-buildPath C:\b\scrubin]
    /// Exit code 0 = success, 1 = failure. Owner: Windows laptop agent.
    /// </summary>
    public static class BuildScript
    {
        public const string DefaultBuildPath = @"C:\b\scrubin";

        [MenuItem("ScrubIn/Build HoloLens (x86)", false, 40)]
        public static void BuildMenu()
        {
            bool ok = Build(DefaultBuildPath);
            EditorUtility.DisplayDialog("ScrubIn",
                ok ? "UWP solution written to " + DefaultBuildPath + "\n\nNext: tools\\build.ps1 -SkipUnity, then tools\\deploy.ps1"
                   : "Build FAILED. See the Console.", "OK");
        }

        public static void BuildBatch()
        {
            string path = GetArg("-buildPath") ?? DefaultBuildPath;
            bool ok;
            try { ok = Build(path); }
            catch (Exception e) { Debug.LogException(e); ok = false; }
            EditorApplication.Exit(ok ? 0 : 1);
        }

        public static bool Build(string outputPath)
        {
            ScrubInProjectSetup.ApplyHoloLensSettings();

            string[] scenes = EditorBuildSettings.scenes.Where(s => s.enabled && File.Exists(s.path)).Select(s => s.path).ToArray();
            if (scenes.Length == 0)
            {
                Debug.LogError("[ScrubIn] No enabled scenes in Build Settings. Run ScrubIn > Setup Project once.");
                return false;
            }

            Directory.CreateDirectory(outputPath);
            var opts = new BuildPlayerOptions
            {
                scenes = scenes,
                locationPathName = outputPath,
                target = BuildTarget.WSAPlayer,
                targetGroup = BuildTargetGroup.WSA,
                options = BuildOptions.None,
            };
            Debug.Log("[ScrubIn] Building UWP solution -> " + outputPath + "  scenes: " + string.Join(", ", scenes));
            BuildReport report = BuildPipeline.BuildPlayer(opts);
            BuildSummary summary = report.summary;
            Debug.Log(string.Format("[ScrubIn] Build {0}: {1} errors, {2} warnings, {3:F0}s, output {4}",
                                    summary.result, summary.totalErrors, summary.totalWarnings,
                                    summary.totalTime.TotalSeconds, summary.outputPath));
            return summary.result == BuildResult.Succeeded;
        }

        static string GetArg(string name)
        {
            var args = Environment.GetCommandLineArgs();
            int i = Array.IndexOf(args, name);
            return (i >= 0 && i + 1 < args.Length) ? args[i + 1] : null;
        }
    }
}
