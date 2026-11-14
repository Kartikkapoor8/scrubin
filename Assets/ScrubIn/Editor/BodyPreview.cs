using System;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace ScrubIn.EditorTools
{
    /// <summary>
    /// Renders the holographic body to PNGs without a headset (black background = how the additive display
    /// composites it), one image per view/layer, and logs triangle counts. The laptop-side visual check.
    ///   Menu: ScrubIn > Render Body Preview      Batch: -executeMethod ScrubIn.EditorTools.BodyPreview.RenderBatch
    /// Output: C:\b\preview\*.png
    /// </summary>
    public static class BodyPreview
    {
        const string OutDir = @"C:\b\preview";

        [MenuItem("ScrubIn/Render Body Preview", false, 60)]
        public static void Render()
        {
            Directory.CreateDirectory(OutDir);
            HoloMaterials.ResetCache();
            GameObject holder = new GameObject("BodyPreviewHolder");
            GameObject camGo = new GameObject("BodyPreviewCamera");
            RenderTexture rt = new RenderTexture(1280, 720, 24, RenderTextureFormat.ARGB32);
            try
            {
                BodyBuilder.Model model = BodyBuilder.Build(holder.transform);
                Debug.Log("[ScrubIn] Body preview: " + model.Parts.Count + " parts, " + model.Triangles + " triangles total.");
                LogLayerTriangles(model);

                Camera cam = camGo.AddComponent<Camera>();
                cam.clearFlags = CameraClearFlags.SolidColor;
                cam.backgroundColor = Color.black;
                cam.nearClipPlane = 0.02f;
                cam.farClipPlane = 10f;
                cam.targetTexture = rt;

                // Body centre in the patient frame: x ~ 0, midline z = -0.24, on the table.
                Vector3 center = new Vector3(-0.02f, 0.02f, -0.24f);
                Shoot(cam, model, BodyMode.Skin, "1-skin-wearer", center + new Vector3(0f, 0.95f, -1.25f), center, 55f, rt);
                Shoot(cam, model, BodyMode.Muscles, "2-muscles", center + new Vector3(0f, 0.95f, -1.25f), center, 55f, rt);
                Shoot(cam, model, BodyMode.Skeleton, "3-skeleton", center + new Vector3(0f, 0.95f, -1.25f), center, 55f, rt);
                Shoot(cam, model, BodyMode.Organs, "4-organs-torso", new Vector3(0.30f, 0.75f, -0.85f), new Vector3(0.30f, 0.05f, -0.24f), 45f, rt);
                Shoot(cam, model, BodyMode.XRay, "5-xray", center + new Vector3(0f, 0.95f, -1.25f), center, 55f, rt);
                Shoot(cam, model, BodyMode.Skin, "6-forearm-window", new Vector3(0.12f, 0.45f, -0.30f), new Vector3(0.12f, 0.0f, 0.0f), 40f, rt);
                Shoot(cam, model, BodyMode.XRay, "7-top-down", new Vector3(-0.02f, 2.2f, -0.24f), center, 50f, rt, Vector3.right);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(holder);
                UnityEngine.Object.DestroyImmediate(camGo);
                rt.Release();
            }
            Debug.Log("[ScrubIn] Body preview written to " + OutDir);
        }

        public static void RenderBatch()
        {
            try { Render(); EditorApplication.Exit(0); }
            catch (Exception e) { Debug.LogException(e); EditorApplication.Exit(1); }
        }

        static void Shoot(Camera cam, BodyBuilder.Model model, BodyMode mode, string name, Vector3 eye, Vector3 target, float fov, RenderTexture rt)
        {
            Shoot(cam, model, mode, name, eye, target, fov, rt, Vector3.up);
        }

        static void Shoot(Camera cam, BodyBuilder.Model model, BodyMode mode, string name, Vector3 eye, Vector3 target, float fov, RenderTexture rt, Vector3 up)
        {
            model.ApplyMode(mode);
            cam.fieldOfView = fov;
            cam.transform.position = eye;
            cam.transform.rotation = Quaternion.LookRotation(target - eye, up);
            cam.Render();
            RenderTexture prev = RenderTexture.active;
            RenderTexture.active = rt;
            Texture2D tex = new Texture2D(rt.width, rt.height, TextureFormat.RGB24, false);
            tex.ReadPixels(new Rect(0, 0, rt.width, rt.height), 0, 0);
            tex.Apply();
            RenderTexture.active = prev;
            File.WriteAllBytes(Path.Combine(OutDir, name + ".png"), tex.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(tex);
        }

        static void LogLayerTriangles(BodyBuilder.Model model)
        {
            int[] perLayer = new int[4];
            for (int i = 0; i < model.Parts.Count; i++)
            {
                MeshFilter f = model.Parts[i].GetComponent<MeshFilter>();
                if (f != null && f.sharedMesh != null) perLayer[(int)model.Parts[i].Layer] += f.sharedMesh.triangles.Length / 3;
            }
            Debug.Log(string.Format("[ScrubIn] Triangles by layer: skin {0}, muscle {1}, skeleton {2}, organs {3}",
                                    perLayer[0], perLayer[1], perLayer[2], perLayer[3]));
        }
    }
}
