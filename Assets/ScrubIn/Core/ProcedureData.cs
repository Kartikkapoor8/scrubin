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
        public string site = "R forearm";
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
        public string firstFeedback = "Suture {n}/{count} \u00B7 bite 5 mm {ok} \u00B7 depth {ok}";
        public string[] attendingLines = new string[0];

        /// <summary>Patient-space x of suture <c>index</c> (0-based).</summary>
        public float X(int index)
        {
            return firstX + spacing * index;
        }

        /// <summary>The spacing readout for suture <c>index</c> in mm (the scripted "measured" value).</summary>
        public float MeasuredSpacing(int index)
        {
            if (index >= 0 && index < measuredSpacingMm.Length && measuredSpacingMm[index] > 0f) return measuredSpacingMm[index];
            return spacing * 1000f;
        }

        /// <summary>Average of the scripted spacings between the first <c>done</c> sutures, in mm.</summary>
        public float AverageSpacing(int done)
        {
            float sum = 0f;
            int n = 0;
            for (int i = 1; i < done; i++)
            {
                sum += MeasuredSpacing(i);
                n++;
            }
            return n > 0 ? sum / n : spacing * 1000f;
        }
    }

    [Serializable]
    public class ScoreData
    {
        public string summary = "{done}/{count} sutures \u00B7 avg spacing {avg} mm \u00B7 time {time}";
    }

    /// <summary>Lines the Attending card shows before the procedure starts.</summary>
    [Serializable]
    public class PromptData
    {
        public string place = "Look at the arm to line up the outline. Air tap to place it.";
        public string begin = "Outline placed. Air tap to begin. Press and hold to reposition.";
    }

    /// <summary>Feature switches. Anything that turns out flaky on the headset gets switched off here, no rebuild of code needed.</summary>
    [Serializable]
    public class OptionsData
    {
        /// <summary>On the headset, the outline follows the wearer's gaze until it is placed (air tap, L, or any nudge).</summary>
        public bool followGazeUntilPlaced = true;

        /// <summary>Before the procedure starts, press-and-hold picks the outline up again.</summary>
        public bool holdToReposition = true;

        /// <summary>Tell the HoloLens to stabilise holograms at the wound (SetFocusPointForFrame).</summary>
        public bool focusPoint = true;

        /// <summary>Show the magnified cross-section of the current suture.</summary>
        public bool stitchDetailView = true;

        public bool sound = true;
    }

    [Serializable]
    public class ProcedureData
    {
        public const string FileName = "procedure.json";

        public int version = 1;
        public string title = "VIPER";
        public string subtitle = "Visual Instruction for Procedures & Emergency Repair";
        public string disclaimer = "Simulated training \u00B7 not medical guidance";
        public PatientData patient = new PatientData();
        public VitalsData vitals = new VitalsData();
        public WoundData wound = new WoundData();
        public SutureData sutures = new SutureData();
        public ScoreData score = new ScoreData();
        public PromptData prompts = new PromptData();
        public OptionsData options = new OptionsData();
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
            if (subtitle == null) subtitle = "";
            if (disclaimer == null) disclaimer = "";
            if (patient == null) patient = new PatientData();
            if (vitals == null) vitals = new VitalsData();
            if (wound == null) wound = new WoundData();
            if (sutures == null) sutures = new SutureData();
            if (score == null) score = new ScoreData();
            if (prompts == null) prompts = new PromptData();
            if (options == null) options = new OptionsData();
            if (prompts.place == null) prompts.place = "";
            if (prompts.begin == null) prompts.begin = "";
            if (sutures.measuredSpacingMm == null) sutures.measuredSpacingMm = new float[0];
            if (sutures.attendingLines == null) sutures.attendingLines = new string[0];
            if (sutures.feedback == null) sutures.feedback = "";
            if (string.IsNullOrEmpty(sutures.firstFeedback)) sutures.firstFeedback = sutures.feedback;
            sutures.count = Mathf.Clamp(sutures.count, 1, 12);
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
                    "Welcome to VIPER. Hold still while I scan the field.",
                    "title", "scan"),
                Step("assess", "Assess the wound", 8f,
                    "Training Patient 01. A 42 mm laceration on the right forearm. Vitals are stable.",
                    "patientCard", "vitals", "wound", "woundDims"),
                Step("xray", "Know what is underneath", 10f,
                    "Check under the skin first. The radial artery runs beside this wound. Avoid the red zone.",
                    "vitals", "wound", "anatomy", "dangerZone"),
                Step("plan", "Plan the repair", 9f,
                    "Five simple interrupted sutures. Bites 5 mm from the edge, 8 mm apart, needle in at 90\u00B0.",
                    "vitals", "wound", "suturePlan", "dangerZone"),
                Step("stitch", "Place the sutures", 22f,
                    "Go ahead. Enter at the dot, follow the arc, and tie it down.",
                    "vitals", "wound", "suturePlan", "stitches", "feedback"),
                Step("complete", "Procedure complete", 10f,
                    "Wound closed. Five for five, even spacing. Well done, doctor.",
                    "stitches", "score")
            };
            d.steps[2].highlights = new[] { "radialArtery", "dangerZone" };
            d.Normalize();
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
