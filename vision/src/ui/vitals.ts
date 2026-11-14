import { add, el } from '../core/dom';
import { PROCEDURE } from '../procedure/data';
import type { Procedure } from '../procedure/machine';

/**
 * The vitals panel (top right): a sweeping ECG trace and the patient's numbers. The values are scripted
 * (this is a training simulation); the trace is synthesised at the same heart rate it shows.
 */
export class VitalsPanel {
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private hr: HTMLSpanElement;
  private spo2: HTMLSpanElement;
  private samples: Float32Array = new Float32Array(0);
  private head = 0;
  private beatPhase = 0;
  private lastValue = 0;
  private on = false;

  constructor(parent: HTMLElement, procedure: Procedure) {
    this.root = add(parent, el('div', 'panel vitals'));
    const head = add(this.root, el('div', 'vitals__head'));
    add(head, el('span', 'panel__label', 'Vitals'));
    add(head, el('span', 'vitals__patient', `${PROCEDURE.patient.name} · ${PROCEDURE.patient.site}`));

    this.canvas = add(this.root, el('canvas', 'vitals__ecg'));
    this.ctx = this.canvas.getContext('2d')!;

    const row = add(this.root, el('div', 'vitals__row'));
    const cell = (label: string, unit: string, tone: string): HTMLSpanElement => {
      const box = add(row, el('div', `vitals__cell vitals__cell--${tone}`));
      add(box, el('div', 'vitals__key', label));
      const line = add(box, el('div', 'vitals__line'));
      const value = add(line, el('span', 'vitals__value'));
      add(line, el('span', 'vitals__unit', unit));
      return value;
    };
    this.hr = cell('HR', 'bpm', 'green');
    cell('BP', 'mmHg', 'white').textContent = PROCEDURE.vitals.bp;
    this.spo2 = cell('SpO2', '%', 'cyan');
    this.hr.textContent = String(PROCEDURE.vitals.hr);
    this.spo2.textContent = String(PROCEDURE.vitals.spo2);

    const show = () => {
      const id = procedure.step.id;
      this.on = id !== 'standby' && id !== 'scan';
      this.root.classList.toggle('panel--on', this.on);
    };
    procedure.on((event) => { if (event.type === 'step' || event.type === 'reset') show(); });
    show();
  }

  /** One beat of a normal ECG, phase 0..1: P wave, the QRS spike, T wave. */
  private static wave(phase: number): number {
    const bump = (centre: number, width: number, height: number) => height * Math.exp(-(((phase - centre) / width) ** 2));
    return bump(0.16, 0.028, 0.13) + bump(0.335, 0.011, -0.16) + bump(0.36, 0.012, 1) + bump(0.388, 0.012, -0.26) + bump(0.6, 0.05, 0.3);
  }

  /** Call every frame. */
  update(t: number, dt: number): void {
    if (!this.on) return;
    const cssWidth = this.canvas.clientWidth;
    const cssHeight = this.canvas.clientHeight;
    if (cssWidth < 2 || cssHeight < 2) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(cssWidth * ratio);
    const height = Math.round(cssHeight * ratio);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.samples = new Float32Array(width);
      this.head = 0;
    }

    // Small, slow variation so the numbers are alive without ever being alarming.
    const hr = PROCEDURE.vitals.hr + Math.round(Math.sin(t * 0.23) * 1.4);
    if (this.hr.textContent !== String(hr)) this.hr.textContent = String(hr);
    const spo2 = PROCEDURE.vitals.spo2 + (Math.sin(t * 0.11) > 0.82 ? 1 : 0);
    if (this.spo2.textContent !== String(spo2)) this.spo2.textContent = String(spo2);

    // The trace sweeps left to right, about 2.6 seconds per pass, overwriting the previous pass.
    const speed = width / 2.6;
    const advance = Math.max(1, Math.round(speed * dt));
    for (let i = 0; i < advance; i++) {
      this.beatPhase = (this.beatPhase + (hr / 60) * (dt / advance)) % 1;
      this.lastValue = VitalsPanel.wave(this.beatPhase) + (Math.random() - 0.5) * 0.012;
      this.samples[this.head] = this.lastValue;
      this.head = (this.head + 1) % width;
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);
    const base = height * 0.7;
    const gain = height * 0.56;
    const gap = Math.round(width * 0.045);
    ctx.lineWidth = 1.6 * ratio;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Older parts of the trace are dimmer; a short gap runs ahead of the head.
    const bands = 6;
    for (let band = 0; band < bands; band++) {
      const fromAge = Math.floor(((width - gap) * band) / bands);
      const toAge = Math.floor(((width - gap) * (band + 1)) / bands);
      ctx.strokeStyle = `rgba(77, 255, 176, ${(1 - band / bands) * 0.68 + 0.32})`;
      ctx.beginPath();
      let started = false;
      for (let age = fromAge; age <= toAge; age++) {
        const x = (this.head - 1 - age + width * 2) % width;
        if (age > 0 && x === width - 1) { started = false; }
        const y = base - this.samples[x] * gain;
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // The bright head.
    const hx = (this.head - 1 + width) % width;
    ctx.fillStyle = '#eafff6';
    ctx.beginPath();
    ctx.arc(hx, base - this.lastValue * gain, 2.2 * ratio, 0, Math.PI * 2);
    ctx.fill();
  }
}
