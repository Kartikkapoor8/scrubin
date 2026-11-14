using System;
using System.IO;
using UnityEngine;

namespace ScrubIn
{
    // The shape of Assets/StreamingAssets/procedure.json (schema in CLAUDE.md). SHARED CONTRACT: add fields,
    // never rename or remove them. Field initializers are the defaults used when the file leaves a field out.

    [Serializable]
    public class StepData
    {
        public string id = "";
        public string title = "";
        public string attending = "";
        public string[] layers = new string[0];
        public string[] highlights = new string[0];
        public float duration = 8f;

        public bool HasLayer(string layer)
        {
            return Array.IndexOf(layers, layer) >= 0;
        }

        public bool HasHighlight(string highlight)
        {
            return Array.IndexOf(highlights, highlight) >= 0;
        }
    }

    [Serializable]
    public class PatientData
    {
        public string name = "Training Patient 01";
        public string procedure = "Laceration repair";
        public string site = "L forearm";
    }

    [Serializable]
    public class VitalsData
    {
        public int hr = 72;
        public string bp = "118/76";
        public int spo2 = 98;
    }

    [Serializable]
    public class WoundData
    {
        public float xStart = 0.100f;
        public float xEnd = 0.142f;
        public float z = 0f;
        public string label = "42 mm";

        public float CenterX { get { return (xStart + xEnd) * 0.5f; } }
        public float Length { get { return Mathf.Abs(xEnd - xStart); } }
    }

    [Serializable]
    public class SutureData
    {
        public int count = 5;
        public float firstX = 0.105f;
        public float spacing = 0.008f;
        public float bite = 0.005f;
        public float[] measuredSpacingMm = { 0f, 8.1f, 7.8f, 7.9f, 7.8f };
        public string feedback = "Suture {n}/{count} \u00B7 spacing {spacing} mm {ok} \u00B7 depth {ok}";
        public string[] attendingLines = new string[0];

        /// <summary>Patient-space x of suture <c>index</c> (0-based).</summary>
        public float X(int index)
        {
            return firstX + spacing * index;
        }
    }

    [Serializable]
    public class ScoreData
    {
        public string summary = "{done}/{count} sutures \u00B7 avg spacing {avg} mm \u00B7 time {time}";
    }

    [Serializable]
    public class ProcedureData
    {
        public const string FileName = "procedure.json";

        public int version = 1;
        public string title = "ScrubIn \u00B7 Surgical Training";
        public string disclaimer = "Simulated training \u00B7 not medical guidance";
        public PatientData patient = new PatientData();
        public VitalsData vitals = new VitalsData();
        public WoundData wound = new WoundData();
        public SutureData sutures = new SutureData();
        public ScoreData score = new ScoreData();
        public StepData[] steps = new StepData[0];

        public int IndexOf(string stepId)
        {
            for (int i = 0; i < steps.Length; i++)
            {
                if (steps[i].id == stepId) return i;
            }
            return -1;
        }

        /// <summary>
        /// Reads StreamingAssets/procedure.json. Never throws and never returns null: if the file is missing
        /// or invalid, the built-in procedure is returned and a warning is recorded for the operator legend.
        /// </summary>
        public static ProcedureData Load()
        {
            string path = Path.Combine(Application.streamingAssetsPath, FileName);
            try
            {
                if (!File.Exists(path))
                {
                    ScrubInLog.Warn(FileName + " not found in StreamingAssets. Using the built-in procedure.");
                    return BuiltIn();
                }

                ProcedureData data = JsonUtility.FromJson<ProcedureData>(File.ReadAllText(path));
                if (data == null || data.steps == null || data.steps.Length == 0)
                {
                    ScrubInLog.Warn(FileName + " has no steps. Using the built-in procedure.");
                    return BuiltIn();
                }

                data.Normalize();
                return data;
            }
            catch (Exception e)
            {
                ScrubInLog.Warn(FileName + " is not valid JSON (" + e.Message + "). Using the built-in procedure.");
                return BuiltIn();
            }
        }

        /// <summary>Fills anything JsonUtility left null so the rest of the code never has to null-check.</summary>
        public void Normalize()
        {
            if (title == null) title = "";
            if (disclaimer == null) disclaimer = "";
            if (patient == null) patient = new PatientData();
            if (vitals == null) vitals = new VitalsData();
            if (wound == null) wound = new WoundData();
            if (sutures == null) sutures = new SutureData();
            if (score == null) score = new ScoreData();
            if (sutures.measuredSpacingMm == null) sutures.measuredSpacingMm = new float[0];
            if (sutures.attendingLines == null) sutures.attendingLines = new string[0];
            if (sutures.count < 1) sutures.count = 1;
            if (steps == null) steps = new StepData[0];

            for (int i = 0; i < steps.Length; i++)
            {
                if (steps[i] == null) steps[i] = new StepData();
                StepData s = steps[i];
                if (s.id == null) s.id = "";
                if (s.title == null) s.title = "";
                if (s.attending == null) s.attending = "";
                if (s.layers == null) s.layers = new string[0];
                if (s.highlights == null) s.highlights = new string[0];
                if (s.duration <= 0f) s.duration = 8f;
            }
        }

        /// <summary>The same procedure as the shipped procedure.json, so a broken file can never stop the demo.</summary>
        public static ProcedureData BuiltIn()
        {
            ProcedureData d = new ProcedureData();
            d.sutures.attendingLines = new[]
            {
                "Good first bite. Hold that depth.",
                "Nice. Keep the spacing even.",
                "Halfway. Tension looks right.",
                "One more after this.",
                "That is the last one. Clean work."
            };
            d.steps = new[]
            {
                Step("boot", "Scanning field", 7f,
                    "Welcome to ScrubIn. Hold still while I scan the field.",
                    "title", "scan"),
                Step("assess", "Assess the wound", 8f,
                    "Training Patient 01. A 42 millimeter laceration on the forearm. Vitals are stable.",
                    "patientCard", "vitals", "wound", "woundDims"),
                Step("xray", "Know what is underneath", 10f,
                    "Look under the skin first. The radial artery runs right beside this wound. Stay out of the red zone.",
                    "vitals", "wound", "anatomy", "dangerZone"),
                Step("plan", "Plan the repair", 9f,
                    "Five simple interrupted sutures. Bites 5 mm from the edge, 8 mm apart, needle in at 90 degrees.",
                    "vitals", "wound", "suturePlan", "dangerZone"),
                Step("stitch", "Place the sutures", 22f,
                    "Go ahead. Enter at the dot, follow the arc, and tie it down.",
                    "vitals", "wound", "suturePlan", "stitches", "feedback"),
                Step("complete", "Procedure complete", 10f,
                    "Wound closed. Five for five, even spacing. Well done, doctor.",
                    "stitches", "score")
            };
            d.steps[2].highlights = new[] { "radialArtery", "dangerZone" };
            return d;
        }

        static StepData Step(string id, string title, float duration, string attending, params string[] layers)
        {
            StepData s = new StepData();
            s.id = id;
            s.title = title;
            s.duration = duration;
            s.attending = attending;
            s.layers = layers;
            return s;
        }
    }
}
