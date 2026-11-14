import { add, el } from '../core/dom';
import type { InputSnapshot } from '../input/manager';

const KEYS: Array<[string, string]> = [
  ['1', 'Input: HoloLens stream'],
  ['2', 'Input: webcam'],
  ['3', 'Input: video file (or drop one on the window)'],
  ['4', 'Input: simulated arm'],
  ['F', 'Full screen'],
  ['O', 'Fill the screen / show the whole picture'],
  ['?', 'Show or hide this list'],
];

/**
 * The fixed chrome around the picture: brand, the "Trainee view · concept" label, status chips, the
 * connection banner and the operator's key list. Panels for the procedure are added by their own modules.
 */
export class Hud {
  readonly root: HTMLDivElement;
  private sourceChip: HTMLDivElement;
  private sourceText: HTMLSpanElement;
  private chips: HTMLDivElement;
  private banner: HTMLDivElement;
  private bannerText: HTMLSpanElement;
  private help: HTMLDivElement;
  private helpGrid: HTMLDivElement;
  private noticeTimer = 0;
  private lastFallback = '';

  constructor(parent: HTMLElement) {
    this.root = add(parent, el('div', 'hud'));

    for (const corner of ['tl', 'tr', 'bl', 'br']) add(this.root, el('div', `frame-tick frame-tick--${corner}`));

    const brand = add(this.root, el('div', 'brand'));
    brand.innerHTML =
      '<svg class="brand__mark" viewBox="0 0 32 32" aria-hidden="true">' +
      '<path d="M5 7l11 18L27 7" fill="none" stroke="#3FE0FF" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M11.5 7L16 14.5 20.5 7" fill="none" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>' +
      '</svg>';
    const words = add(brand, el('div'));
    add(words, el('div', 'brand__name', 'VIPER'));
    add(words, el('div', 'brand__sub', 'Visual Instruction for Procedures & Emergency Repair'));

    add(this.root, el('div', 'corner-label', 'Trainee view · concept'));

    this.chips = add(this.root, el('div', 'chips'));
    this.sourceChip = add(this.chips, el('div', 'chip'));
    add(this.sourceChip, el('span', 'chip__dot'));
    this.sourceText = add(this.sourceChip, el('span'));

    this.banner = add(this.root, el('div', 'banner'));
    add(this.banner, el('span', 'banner__spinner'));
    this.bannerText = add(this.banner, el('span', 'banner__text'));

    this.help = add(this.root, el('div', 'help'));
    add(this.help, el('div', 'help__title', 'Operator keys'));
    this.helpGrid = add(this.help, el('div', 'help__grid'));
    add(this.help, el('div', 'help__note', 'Only the operator needs this list. Press ? to hide it.'));
    this.setKeys(KEYS);
  }

  /** Adds a chip to the status row (tracking, hand, microphone...). Returns it so its owner can update it. */
  addChip(text: string): StatusChip {
    return new StatusChip(this.chips, text);
  }

  /** Replace the key list (later modules add their own keys). */
  setKeys(keys: Array<[string, string]>): void {
    this.helpGrid.textContent = '';
    for (const [key, what] of keys) {
      const row = add(this.helpGrid, el('div', 'help__row'));
      add(row, el('span', 'help__keys', key));
      add(row, el('span', '', what));
    }
  }

  get keys(): Array<[string, string]> {
    return KEYS.slice();
  }

  toggleHelp(force?: boolean): void {
    this.help.classList.toggle('help--on', force);
  }

  /** Drop every fade for a moment, so a reset is instant rather than a slow dissolve. */
  snap(): void {
    this.root.classList.add('hud--snap');
    window.setTimeout(() => this.root.classList.remove('hud--snap'), 120);
  }

  setHidden(hidden: boolean): void {
    this.root.classList.toggle('hud--hidden', hidden);
  }

  setInput(snapshot: InputSnapshot): void {
    const { status, label } = snapshot;
    const chip = this.sourceChip;
    chip.classList.remove('chip--ok', 'chip--busy', 'chip--bad');

    if (status.state === 'live') {
      chip.classList.add('chip--ok');
      this.sourceText.textContent = `Live · ${label}`;
    } else if (status.state === 'unavailable') {
      chip.classList.add('chip--bad');
      this.sourceText.textContent = `No signal · ${label}`;
    } else {
      chip.classList.add('chip--busy');
      this.sourceText.textContent = `${status.state === 'reconnecting' ? 'Reconnecting' : 'Connecting'} · ${label}`;
    }

    // The banner only speaks when something needs saying.
    window.clearTimeout(this.noticeTimer);
    if (status.state === 'reconnecting') {
      this.showBanner(`Reconnecting to ${label}${status.detail ? ' · ' + status.detail : ''}`, false);
    } else if (status.state === 'unavailable') {
      this.showBanner(`${label} unavailable${status.detail ? ' · ' + status.detail : ''}`, false);
    } else if (status.state === 'live' && snapshot.fellBackFrom && snapshot.fellBackFrom !== this.lastFallback) {
      this.lastFallback = snapshot.fellBackFrom;
      this.showBanner(`${snapshot.fellBackFrom} · showing ${label}`, true);
      this.noticeTimer = window.setTimeout(() => this.banner.classList.remove('banner--on'), 7000);
    } else if (status.state === 'live') {
      this.banner.classList.remove('banner--on');
    }
    if (!snapshot.fellBackFrom) this.lastFallback = '';
  }

  /** A short operator notice (for example "Marker colour set"). Disappears by itself. */
  notice(text: string, ms = 3500): void {
    window.clearTimeout(this.noticeTimer);
    this.showBanner(text, true);
    this.noticeTimer = window.setTimeout(() => this.banner.classList.remove('banner--on'), ms);
  }

  private showBanner(text: string, info: boolean): void {
    this.bannerText.textContent = text;
    this.banner.classList.toggle('banner--info', info);
    this.banner.classList.add('banner--on');
  }
}

export class StatusChip {
  private root: HTMLDivElement;
  private text: HTMLSpanElement;

  constructor(parent: HTMLElement, text: string) {
    this.root = el('div', 'chip chip--off');
    add(this.root, el('span', 'chip__dot'));
    this.text = add(this.root, el('span', '', text));
    parent.insertBefore(this.root, parent.firstChild);
  }

  /** Take the chip out of the row entirely (for states that are usually irrelevant, like autoplay). */
  show(visible: boolean): void {
    const display = visible ? '' : 'none';
    if (this.root.style.display !== display) this.root.style.display = display;
  }

  set(text: string, tone: 'ok' | 'busy' | 'bad' | 'off' | 'rec'): void {
    if (this.text.textContent !== text) this.text.textContent = text;
    for (const t of ['ok', 'busy', 'bad', 'off', 'rec']) this.root.classList.toggle(`chip--${t}`, t === tone);
  }
}
