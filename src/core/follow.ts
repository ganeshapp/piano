import { handList, unique, type Step } from "./model";
export type MidiEvent =
  | { type: "on" | "off"; pitch: number; channel: number }
  | { type: "pedal"; down: boolean; channel: number };
export function decodeMidi(data: ArrayLike<number>): MidiEvent | null {
  const status = data[0] & 0xf0,
    channel = data[0] & 15,
    pitch = data[1];
  if (status === 0x90 && data[2] > 0) return { type: "on", pitch, channel };
  if (status === 0x80 || (status === 0x90 && data[2] === 0))
    return { type: "off", pitch, channel };
  if (status === 0xb0 && pitch === 64)
    return { type: "pedal", down: data[2] >= 64, channel };
  return null;
}
export class Follower {
  index = 0;
  done = false;
  pressed = new Set<number>();
  wrong = new Set<number>();
  pedal = false;
  private channelKeys = new Set<string>();
  private fresh = new Set<number>();
  private tolerated = new Set<number>();
  constructor(
    public steps: Step[],
    start = 0,
  ) {
    this.index = start;
    this.skipReleases();
  }
  get expected() {
    return this.done
      ? []
      : unique(
          handList.flatMap((h) => this.steps[this.index]?.attacks[h] || []),
        );
  }
  private skipReleases() {
    while (
      this.index < this.steps.length &&
      !handList.some((h) => this.steps[this.index].attacks[h].length)
    )
      this.index++;
    this.done = this.index >= this.steps.length;
  }
  resetInput() {
    this.channelKeys.clear();
    this.pressed.clear();
    this.wrong.clear();
    this.fresh.clear();
    this.tolerated.clear();
    this.pedal = false;
  }
  input(e: MidiEvent) {
    if (e.type === "pedal") {
      this.pedal = e.down;
      return false;
    }
    const key = `${e.channel}:${e.pitch}`;
    if (e.type === "off") {
      this.channelKeys.delete(key);
      if (
        ![...this.channelKeys].some((k) => Number(k.split(":")[1]) === e.pitch)
      ) {
        this.pressed.delete(e.pitch);
        this.fresh.delete(e.pitch);
        this.wrong.delete(e.pitch);
        this.tolerated.delete(e.pitch);
      }
    } else if (!this.channelKeys.has(key)) {
      const already = this.pressed.has(e.pitch);
      this.channelKeys.add(key);
      this.pressed.add(e.pitch);
      if (!already) this.fresh.add(e.pitch);
      const expected = this.expected;
      const continuing = this.steps[this.index]
        ? handList.flatMap((h) => this.steps[this.index].before[h])
        : [];
      if (
        !expected.includes(e.pitch) &&
        !continuing.includes(e.pitch) &&
        !this.tolerated.has(e.pitch)
      )
        this.wrong.add(e.pitch);
    }
    if (this.done) return false;
    if (
      this.expected.length &&
      this.expected.every((p) => this.pressed.has(p) && this.fresh.has(p)) &&
      !this.wrong.size
    ) {
      this.tolerated = new Set(this.pressed);
      this.fresh.clear();
      this.index++;
      this.skipReleases();
      return true;
    }
    return false;
  }
}
