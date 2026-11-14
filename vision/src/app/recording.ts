import type { StatusChip } from '../ui/hud';

interface RecordStatus {
  recording: boolean;
  waiting: boolean;
  file: string;
  seconds: number;
  limit: number;
  canRecord: boolean;
  last: { ok: boolean; file?: string; seconds?: number; megabytes?: number; detail?: string; reason?: string } | null;
}

/**
 * Key C: record the raw incoming HoloLens stream (no overlays) to vision/media/. The recording itself is
 * done by the local server as the bytes pass through the relay; this only starts, stops and reports it.
 * The newest clip is what key 3 plays, so a recording is at once the backup input and footage for the video.
 */
export class StreamRecording {
  active = false;
  private timer = 0;

  constructor(
    private chip: StatusChip,
    private notice: (text: string, ms?: number) => void,
    private onSaved: (file: string) => void,
  ) {
    chip.show(false);
  }

  /** Start, or stop if one is running. `seconds` > 0 stops by itself after that long. */
  async toggle(seconds = 0): Promise<void> {
    try {
      if (this.active) {
        await fetch('/api/record/stop', { method: 'POST' });
        await this.poll();
        return;
      }
      const res = await fetch(`/api/record/start?seconds=${seconds}`, { method: 'POST' });
      const body = await res.json();
      if (!body.ok) {
        this.notice(body.detail || 'Recording is not available right now', 4000);
        return;
      }
      this.active = true;
      this.chip.show(true);
      this.chip.set('Rec', 'rec');
      this.notice(seconds > 0 ? `Recording the raw stream for ${seconds} s` : 'Recording the raw stream  ·  C stops', 2500);
      window.clearInterval(this.timer);
      this.timer = window.setInterval(() => void this.poll(), 500);
    } catch {
      this.notice('The local server did not answer', 3000);
    }
  }

  private async poll(): Promise<void> {
    let status: RecordStatus;
    try {
      status = (await (await fetch('/api/record', { cache: 'no-store' })).json()) as RecordStatus;
    } catch {
      return;
    }
    if (status.recording) {
      const s = Math.floor(status.seconds);
      this.chip.set(`Rec ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}${status.limit ? ` / ${status.limit}s` : ''}`, 'rec');
      return;
    }
    if (!this.active) return;
    this.active = false;
    window.clearInterval(this.timer);
    this.chip.show(false);
    const last = status.last;
    if (last && last.ok && last.file) {
      this.notice(`Saved media/${last.file}  ·  ${last.seconds} s, ${last.megabytes} MB  ·  key 3 plays it`, 7000);
      this.onSaved(last.file);
    } else {
      this.notice(last?.detail || 'Nothing was recorded', 5000);
    }
  }
}
