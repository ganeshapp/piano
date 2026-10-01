import { activeAt } from "./notation";
import { handList, unique, type Step } from "./model";
import { PianoAudio } from "./audio";
export interface SoundSink {
  on(p: number, time: number): void;
  off(p: number, time: number): void;
  stop(): void;
}
export function playbackTimes(
  steps: Step[],
  steady: boolean,
  interval: number,
) {
  return steps.map((s, i) => (steady ? i * interval : s.seconds));
}
export class Transport {
  running = false;
  position = 0;
  speed = 1;
  loop = false;
  private generation = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private origin = 0;
  private scheduleIndex = 0;
  private frame = 0;
  times: number[] = [];
  end = 0;
  steps: Step[] = [];
  onFrame: (index: number, position: number, running: boolean) => void =
    () => {};
  constructor(
    public audio: PianoAudio,
    public sink: SoundSink = audio,
  ) {}
  configure(steps: Step[], steady: boolean, interval: number, end: number) {
    this.stop();
    this.steps = steps;
    this.times = playbackTimes(steps, steady, interval);
    this.end = steady
      ? Math.max(interval, steps.length * interval)
      : Math.max(end, this.times.at(-1) || 0);
  }
  currentIndex() {
    return activeAt(
      this.steps.map((s, i) => ({ ...s, seconds: this.times[i] })),
      this.position,
    );
  }
  async play() {
    if (this.running) return;
    const generation = ++this.generation;
    await this.audio.init();
    if (generation !== this.generation || !this.steps.length) return;
    if (this.position >= this.end) this.position = 0;
    this.running = true;
    this.origin = this.audio.now - this.position / this.speed;
    this.scheduleIndex = this.times.findIndex((t) => t >= this.position - 1e-7);
    if (this.scheduleIndex < 0) this.scheduleIndex = this.steps.length;
    // Restore state before the next scheduled event when resuming or seeking.
    const prior = this.scheduleIndex - 1;
    if (prior >= 0)
      for (const p of unique(
        handList.flatMap((h) => this.steps[prior].after[h]),
      ))
        this.sink.on(p, this.audio.now);
    this.pump();
    this.timer = setInterval(() => this.pump(), 25);
    this.draw();
  }
  private pump() {
    if (!this.running) return;
    const horizon = this.audio.now + 0.09;
    while (this.scheduleIndex < this.steps.length) {
      const i = this.scheduleIndex,
        time = this.origin + this.times[i] / this.speed;
      if (time > horizon) break;
      const s = this.steps[i],
        before = unique(handList.flatMap((h) => s.before[h])),
        after = unique(handList.flatMap((h) => s.after[h])),
        attacks = unique(handList.flatMap((h) => s.attacks[h]));
      for (const p of before)
        if (!after.includes(p) || attacks.includes(p))
          this.sink.off(p, Math.max(time, this.audio.now));
      for (const p of attacks) this.sink.on(p, Math.max(time, this.audio.now));
      this.scheduleIndex++;
    }
  }
  private draw = () => {
    if (!this.running) return;
    this.position = Math.max(0, (this.audio.now - this.origin) * this.speed);
    if (this.position >= this.end) {
      this.pause();
      this.position = this.loop ? 0 : this.end;
      this.onFrame(this.loop ? 0 : this.steps.length - 1, this.position, false);
      if (this.loop) void this.play();
      return;
    }
    let lo = 0,
      hi = this.times.length - 1,
      index = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (this.times[m] <= this.position) {
        index = m;
        lo = m + 1;
      } else hi = m - 1;
    }
    this.onFrame(index, this.position, true);
    this.frame = requestAnimationFrame(this.draw);
  };
  pause() {
    this.generation++;
    if (this.running)
      this.position = Math.min(
        this.end,
        Math.max(0, (this.audio.now - this.origin) * this.speed),
      );
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    cancelAnimationFrame(this.frame);
    this.sink.stop();
    this.onFrame(this.currentIndex(), this.position, false);
  }
  stop() {
    this.pause();
    this.position = 0;
  }
  seek(index: number) {
    this.pause();
    this.position = this.times[index] || 0;
    this.onFrame(index, this.position, false);
  }
}
