/** Small DOM helpers. The app has no framework: the HUD is a handful of elements built once. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function add<T extends Node>(parent: Node, ...children: T[]): T {
  for (const child of children) parent.appendChild(child);
  return children[0];
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Frame-rate independent smoothing factor: how far to move toward a target this frame. */
export function damp(ratePerSecond: number, dt: number): number {
  return 1 - Math.exp(-ratePerSecond * dt);
}

export const ease = {
  outCubic: (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3),
  outQuart: (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 4),
  inOutCubic: (t: number) => {
    const x = clamp(t, 0, 1);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  },
  outBack: (t: number) => {
    const x = clamp(t, 0, 1);
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  },
};

/** 0 before `start`, 1 after `start + duration`, linear in between. */
export function progress(t: number, start: number, duration: number): number {
  if (duration <= 0) return t >= start ? 1 : 0;
  return clamp((t - start) / duration, 0, 1);
}
