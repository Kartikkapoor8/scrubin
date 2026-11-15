import { animate } from 'motion';

/**
 * How the HUD moves. One spring for everything that changes place or size, one quick ease for things
 * leaving, one ease-out for numbers that count. Drawn overlays use the same spring (core/dom.ts `spring`
 * and `pop`), and CSS-only transitions use it through --spring (ui/hud.css), so the whole screen has one
 * character.
 */
export const SPRING = { type: 'spring' as const, stiffness: 260, damping: 26, mass: 1 };
/** The same spring, slower, for large things (the idle screen, the score). */
export const SPRING_SOFT = { type: 'spring' as const, stiffness: 150, damping: 21, mass: 1 };
/** Livelier, for small things that pop (nodes, check marks, chips). */
export const SPRING_POP = { type: 'spring' as const, stiffness: 520, damping: 32, mass: 1 };
const EXIT = { duration: 0.18, ease: [0.4, 0, 1, 1] as [number, number, number, number] };
const COUNT = [0.16, 1, 0.3, 1] as [number, number, number, number];

type Target = Element | Element[] | NodeListOf<Element>;
interface Playing { complete(): void; stop(): void }

const playing = new Set<Playing>();
let instantUntil = 0;

function track<T extends Playing & { finished: Promise<unknown> }>(animation: T): T {
  playing.add(animation);
  animation.finished.then(() => playing.delete(animation), () => playing.delete(animation));
  return animation;
}

/** Reset: whatever is moving jumps to where it was going, and for a moment nothing new animates. */
export function snapMotion(ms = 160): void {
  instantUntil = performance.now() + ms;
  for (const animation of [...playing]) {
    try { animation.complete(); } catch { /* already finished */ }
  }
  playing.clear();
}

const isInstant = () => performance.now() < instantUntil;

export interface EnterOptions {
  /** Start this far below (px, or a CSS length) and rise into place. */
  y?: number | string;
  x?: number | string;
  /** Start at this scale. */
  scale?: number;
  delay?: number;
  /** Seconds between one element and the next, when several are given. */
  each?: number;
  spring?: typeof SPRING;
  blur?: number;
}

function list(target: Target): Element[] {
  return target instanceof Element ? [target] : Array.from(target);
}

/** Bring one element, or several one after another, into place. */
export function enter(target: Target, options: EnterOptions = {}): void {
  const { y = 14, x = 0, scale = 1, delay = 0, each = 0.06, spring = SPRING, blur = 0 } = options;
  const from: Record<string, unknown[]> = { opacity: [0, 1] };
  if (y) from.y = [y, 0];
  if (x) from.x = [x, 0];
  if (scale !== 1) from.scale = [scale, 1];
  if (blur) from.filter = [`blur(${blur}px)`, 'blur(0px)'];
  const instant = isInstant();
  list(target).forEach((node, i) => {
    if (instant) {
      track(animate(node, { opacity: 1, y: 0, x: 0, scale: 1, ...(blur ? { filter: 'blur(0px)' } : {}) }, { duration: 0 }));
      return;
    }
    const wait = delay + i * each;
    track(animate(node, from as never, { ...spring, delay: wait, opacity: { duration: 0.28, ease: 'easeOut', delay: wait } }));
  });
}

/** Take an element away: quick, and never in the way of what comes next. */
export function leave(target: Target, options: { y?: number | string; scale?: number } = {}): void {
  const to: Record<string, unknown> = { opacity: 0 };
  if (options.y !== undefined) to.y = options.y;
  if (options.scale !== undefined) to.scale = options.scale;
  track(animate(target, to as never, isInstant() ? { duration: 0 } : EXIT));
}

/** Move to a state from wherever the element is now (interruptible). */
export function to(target: Target, values: Record<string, unknown>, options: { spring?: typeof SPRING; delay?: number } = {}): void {
  track(animate(target, values as never, isInstant() ? { duration: 0 } : { ...(options.spring ?? SPRING), delay: options.delay ?? 0 }));
}

export interface TickerOptions {
  from?: number;
  decimals?: number;
  duration?: number;
  delay?: number;
  format?: (value: number) => string;
}

/** A number that counts up to its value instead of appearing. */
export function ticker(node: HTMLElement, value: number, options: TickerOptions = {}): void {
  const decimals = options.decimals ?? 0;
  const format = options.format ?? ((v: number) => v.toFixed(decimals));
  if (isInstant()) { node.textContent = format(value); return; }
  node.textContent = format(options.from ?? 0);
  track(animate(options.from ?? 0, value, {
    duration: options.duration ?? 0.9,
    delay: options.delay ?? 0,
    ease: COUNT,
    onUpdate: (v: number) => { node.textContent = format(v); },
    onComplete: () => { node.textContent = format(value); },
  }));
}

/** A light sweep across a panel as it arrives (the element needs the `sweep` class; see ui/hud.css). */
export function sweep(node: HTMLElement): void {
  if (isInstant()) return;
  node.classList.remove('sweep--run');
  void node.offsetWidth;
  node.classList.add('sweep--run');
}

/** Wraps every number in a string in a span, so numbers are set in the numeral typeface. */
export function numerals(node: HTMLElement, value: string): void {
  node.textContent = '';
  for (const piece of value.split(/(\d+(?:[.:/]\d+)*)/)) {
    if (!piece) continue;
    if (/^\d/.test(piece)) {
      const span = document.createElement('span');
      span.className = 'num';
      span.textContent = piece;
      node.appendChild(span);
    } else node.appendChild(document.createTextNode(piece));
  }
}
