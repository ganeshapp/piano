import { decodeMidi, type MidiEvent } from "./follow";
// Web MIDI types kept local so non-MIDI browsers still build and run.
interface Port {
  id: string;
  name?: string;
  state: string;
  onmidimessage: ((e: { data: Uint8Array }) => void) | null;
  send?: (data: number[], timestamp?: number) => void;
  clear?: () => void;
}
interface Access {
  inputs: Map<string, Port>;
  outputs: Map<string, Port>;
  onstatechange: (() => void) | null;
}
export class MidiConnection {
  access: Access | null = null;
  input = "";
  output = "";
  message = "Piano not connected";
  onChange = () => {};
  onEvent: (e: MidiEvent) => void = () => {};
  onDisconnect = () => {};
  get supported() {
    return "requestMIDIAccess" in navigator;
  }
  get inputs() {
    return [...(this.access?.inputs.values() || [])].filter(
      (p) => p.state === "connected",
    );
  }
  get outputs() {
    return [...(this.access?.outputs.values() || [])].filter(
      (p) => p.state === "connected",
    );
  }
  async connect() {
    if (!this.supported)
      throw Error(
        "MIDI is unavailable in this browser. Try Chrome or Edge on your laptop. All listening and manual practice tools still work.",
      );
    try {
      this.access = await (
        navigator as unknown as {
          requestMIDIAccess: (o: { sysex: boolean }) => Promise<Access>;
        }
      ).requestMIDIAccess({ sysex: false });
      this.access.onstatechange = () => {
        this.bind();
        this.onChange();
      };
      this.bind();
    } catch {
      throw Error(
        "Piano connection was not allowed. Check the browser permission and try again.",
      );
    }
  }
  bind() {
    for (const p of this.access?.inputs.values() || []) p.onmidimessage = null;
    const chosen =
      this.inputs.find((p) => p.id === this.input) || this.inputs[0];
    const old = this.input;
    this.input = chosen?.id || "";
    if (old !== this.input || !chosen) this.onDisconnect();
    if (chosen)
      chosen.onmidimessage = (e) => {
        const event = decodeMidi(e.data);
        if (event) this.onEvent(event);
      };
    if (this.output && !this.outputs.some((p) => p.id === this.output)) {
      this.output = "";
      this.onDisconnect();
    }
    this.message = chosen
      ? chosen.name || "Connected piano"
      : "No piano found. Connect its USB/MIDI cable, then try again.";
    this.onChange();
  }
  send(data: number[], delay = 0) {
    this.outputs
      .find((p) => p.id === this.output)
      ?.send?.(data, performance.now() + Math.max(0, delay) * 1000);
  }
  panic() {
    const port = this.outputs.find((p) => p.id === this.output);
    port?.clear?.();
    for (let channel = 0; channel < 16; channel++) {
      port?.send?.([0xb0 + channel, 64, 0]);
      port?.send?.([0xb0 + channel, 123, 0]);
    }
  }
  dispose() {
    this.panic();
    for (const p of this.access?.inputs.values() || []) p.onmidimessage = null;
    if (this.access) this.access.onstatechange = null;
  }
}
