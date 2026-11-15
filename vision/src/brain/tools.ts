import type { FunctionDeclaration } from '@google/genai';

/** Structures the attending can point at. The anatomy layer draws them; the names are part of the tool. */
export const STRUCTURES = ['radial_artery', 'ulnar_artery', 'veins', 'median_nerve', 'flexor_tendons', 'danger_zone', 'wound'] as const;
export type Structure = (typeof STRUCTURES)[number];

export const STEP_NAMES = ['scan', 'assess', 'anatomy', 'plan', 'stitch', 'complete'] as const;

/** What the app lets the attending do and know. Implemented in main.ts over the procedure and the scene. */
export interface BrainHost {
  /** Where the procedure is, in plain language, for the model. */
  describeState(): string;
  stateData(): Record<string, unknown>;
  /** Moves on. Returns '' when it did, or the reason it could not (for the model to say). */
  nextStep(): string;
  previousStep(): void;
  repeatStep(): void;
  /** Jumps to a step. Returns '' when it did, or the reason it could not. */
  goToStep(step: string): string;
  highlight(structure: Structure): void;
  /** The picture the audience sees right now (video + overlays) as a base64 JPEG, or null. */
  captureView(): string | null;
}

const PROMPT_ROLE = `You are Gemini, the AI attending surgeon in VIPER, a surgical training demo shown to an audience. A trainee wearing a headset is repairing a 42 mm linear laceration on the volar side of a training patient's right forearm with five simple interrupted sutures: bites 5 mm from the wound edge, 8 mm apart, needle entering the skin at 90 degrees. You see through the trainee's eyes and coach them out loud.

How to answer:
- Sound like a calm, experienced attending at the table. One or two short sentences, under 20 words. No lists, no preamble.
- The trainee gets your attention by saying "Hey Gemini". Never comment on that greeting; answer what follows it.
- This is a simulation for teaching technique on a training model. Never give medical advice about real patients.`;

const PROMPT_TOOLS = `
- Every time you answer a question, also call show_answer_card with the same answer in writing (under 20 words) and a title of one to three words.
- If the trainee asks about a structure in the arm (an artery, a vein, the nerve, the tendons, the danger zone, the wound), call highlight_structure for it and name it in your answer.
- If they ask what they are looking at, what you can see, or anything about the picture, call look_at_view first and answer from what it shows.
- If they ask where they are in the procedure, what comes next, or how they are doing, call get_procedure_state first.
- If they ask to move on, go back, repeat a step or jump to a step, call the matching tool and confirm in a few words.
- You cannot place sutures or skip them: the trainee places each one. If a tool answers that sutures remain, say how many are left instead of moving on.`;

const PROMPT_REST = `
- Messages that start with [state] come from the app, not from the trainee. They tell you where the procedure is. Never reply to them and never mention them.
- If what you hear is not addressed to you (narration to the audience, background talk), stay silent.

Anatomy shown in this demo, volar right forearm, wrist toward elbow:
- Radial artery: thumb side, runs close beside this wound. It is why there is a red danger zone on that side.
- Ulnar artery: little-finger side, with the ulnar nerve beside it.
- Median nerve: down the middle, deep to the flexor tendons.
- Superficial veins: cephalic on the thumb side, basilic on the little-finger side, just under the skin.
- Flexor tendons: centre of the forearm, becoming cord-like toward the wrist.

The procedure, in order: 1 Scan the field. 2 Assess the wound: 42 mm, linear, clean edges. 3 Anatomy: know what is underneath before the needle goes in. 4 Plan: five sutures, 8 mm apart, 5 mm bites. 5 Stitch: place sutures one to five, entering at the dot and following the arc. 6 Complete: wound closed, score shown.`;

/** The attending's instructions. Without tools (the most conservative session setup) the tool rules are left out. */
export function systemPrompt(withTools: boolean): string {
  return PROMPT_ROLE + (withTools ? PROMPT_TOOLS : '') + PROMPT_REST;
}

/**
 * Tools the attending can call. Some only change the screen; the others return information.
 * Pass the SDK's Behavior values to mark which is which; pass nothing for a plain declaration list
 * (the conservative session setup).
 */
export function toolDeclarations(blocking?: FunctionDeclaration['behavior'], nonBlocking?: FunctionDeclaration['behavior']): FunctionDeclaration[] {
  const declarations = allTools(blocking, nonBlocking);
  if (blocking === undefined) for (const declaration of declarations) delete declaration.behavior;
  return declarations;
}

function allTools(blocking: FunctionDeclaration['behavior'], nonBlocking: FunctionDeclaration['behavior']): FunctionDeclaration[] {
  return [
    {
      name: 'show_answer_card',
      description: 'Show your answer in writing on the Gemini panel the audience sees. Call it every time you answer a question.',
      behavior: nonBlocking,
      parametersJsonSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'One to three words naming the topic, for example "Radial artery".' },
          text: { type: 'string', description: 'The answer, under 20 words, as you would say it.' },
        },
        required: ['text'],
      },
    },
    {
      name: 'highlight_structure',
      description: 'Light up one structure on the anatomy overlay for a few seconds so the trainee and the audience can see what you mean.',
      behavior: nonBlocking,
      parametersJsonSchema: {
        type: 'object',
        properties: { structure: { type: 'string', enum: [...STRUCTURES] } },
        required: ['structure'],
      },
    },
    {
      name: 'look_at_view',
      description: "Get the trainee's current view as an image (the camera picture with the overlays on it). Call this before answering anything about what is visible.",
      behavior: blocking,
      parametersJsonSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_procedure_state',
      description: 'Where the procedure is right now: the current step, how many sutures are placed, whether the wound is being tracked.',
      behavior: blocking,
      parametersJsonSchema: { type: 'object', properties: {} },
    },
    {
      name: 'next_step',
      description: 'Move the procedure on to the next step.',
      behavior: nonBlocking,
      parametersJsonSchema: { type: 'object', properties: {} },
    },
    {
      name: 'previous_step',
      description: 'Go back one step.',
      behavior: nonBlocking,
      parametersJsonSchema: { type: 'object', properties: {} },
    },
    {
      name: 'repeat_step',
      description: 'Play the current step again from its beginning.',
      behavior: nonBlocking,
      parametersJsonSchema: { type: 'object', properties: {} },
    },
    {
      name: 'go_to_step',
      description: 'Jump straight to a named step.',
      behavior: nonBlocking,
      parametersJsonSchema: {
        type: 'object',
        properties: { step: { type: 'string', enum: [...STEP_NAMES] } },
        required: ['step'],
      },
    },
  ];
}

export const SILENT_TOOLS = new Set(['show_answer_card', 'highlight_structure', 'next_step', 'previous_step', 'repeat_step', 'go_to_step']);
