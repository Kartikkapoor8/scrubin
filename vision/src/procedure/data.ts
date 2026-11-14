/**
 * The procedure VIPER Vision plays. All wording the audience sees lives here, so text changes never need a
 * code change. Step ids are stable; code switches on the id, never on the position.
 */
export type StepId = 'standby' | 'scan' | 'assess' | 'anatomy' | 'plan' | 'stitch' | 'complete';

export interface StepDef {
  id: StepId;
  /** Two or three letters shown in the step rail. */
  short: string;
  title: string;
  /** What the attending says on entering the step. */
  line: string;
  /** Seconds before autoplay moves on. */
  duration: number;
}

export const PROCEDURE = {
  title: 'VIPER',
  subtitle: 'Visual Instruction for Procedures & Emergency Repair',
  cornerLabel: 'Trainee view · concept',
  patient: { name: 'Training Patient 01', procedure: 'Laceration repair', site: 'R forearm' },
  vitals: { hr: 72, bp: '118/76', spo2: 98 },
  wound: { lengthMm: 42, label: 'Laceration' },
  sutures: {
    count: 5,
    spacingMm: 8,
    biteMm: 5,
    /** Scripted "measured" spacing shown after each stitch (the first has no neighbour yet). */
    measuredSpacingMm: [0, 8.1, 7.8, 7.9, 7.8],
    firstFeedback: 'Suture {n}/{count} · bite {bite} mm {ok} · depth {ok}',
    feedback: 'Suture {n}/{count} · spacing {spacing} mm {ok} · depth {ok}',
    lines: [
      'Good first bite. Hold that depth.',
      'Nice. Keep the spacing even.',
      'Halfway. Tension looks right.',
      'One more after this.',
      'That is the last one. Clean work.',
    ],
  },
  steps: [
    { id: 'standby', short: 'RDY', title: 'Ready', line: 'Bring the wound into view, then press Next.', duration: 4 },
    { id: 'scan', short: 'SCN', title: 'Scanning the field', line: 'Welcome to VIPER. Hold still while I scan the field.', duration: 6 },
    { id: 'assess', short: 'ASM', title: 'Assess the wound', line: 'Training Patient 01. A 42 mm laceration on the right forearm. Vitals are stable.', duration: 7 },
    { id: 'anatomy', short: 'ANT', title: 'Know what is underneath', line: 'Check under the skin first. The radial artery runs beside this wound. Avoid the red zone.', duration: 9 },
    { id: 'plan', short: 'PLN', title: 'Plan the repair', line: 'Five simple interrupted sutures. Bites 5 mm from the edge, 8 mm apart, needle in at 90°.', duration: 8 },
    { id: 'stitch', short: 'SUT', title: 'Place the sutures', line: 'Go ahead. Enter at the dot, follow the arc, and tie it down.', duration: 4 },
    { id: 'complete', short: 'END', title: 'Procedure complete', line: 'Wound closed. Five for five, even spacing. Well done, doctor.', duration: 10 },
  ] as StepDef[],
};

/** Where suture `index` sits along the wound, in millimetres from the wound's centre. */
export function sutureOffsetMm(index: number): number {
  const { count, spacingMm } = PROCEDURE.sutures;
  return (index - (count - 1) / 2) * spacingMm;
}
