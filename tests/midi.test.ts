import { describe, it, expect, vi, afterEach } from "vitest";
import { MidiConnection } from "../src/core/midi";
const port = (id: string) => ({
  id,
  name: id,
  state: "connected",
  onmidimessage: null as null | ((e: { data: Uint8Array }) => void),
  send: vi.fn(),
  clear: vi.fn(),
});
const install = () => {
  const a = port("Piano A"),
    b = port("Piano B"),
    out = port("Output");
  const access = {
    inputs: new Map([
      [a.id, a],
      [b.id, b],
    ]),
    outputs: new Map([[out.id, out]]),
    onstatechange: null as null | (() => void),
  };
  const request = vi.fn(async () => access);
  vi.stubGlobal("navigator", { requestMIDIAccess: request });
  return { a, b, out, access, request };
};
afterEach(() => vi.unstubAllGlobals());
describe("MIDI connection and routing", () => {
  it("keeps non-MIDI environments usable with an actionable error", async () => {
    vi.stubGlobal("navigator", {});
    const midi = new MidiConnection();
    expect(midi.supported).toBe(false);
    await expect(midi.connect()).rejects.toThrow(/Chrome or Edge/);
  });
  it("handles declined permission", async () => {
    vi.stubGlobal("navigator", {
      requestMIDIAccess: async () => {
        throw Error("NotAllowed");
      },
    });
    await expect(new MidiConnection().connect()).rejects.toThrow(/not allowed/);
  });
  it("binds one input, changes device and recovers after disconnect", async () => {
    const { a, b, access, request } = install();
    const midi = new MidiConnection();
    midi.onEvent = vi.fn();
    midi.onDisconnect = vi.fn();
    await midi.connect();
    expect(request).toHaveBeenCalledWith({ sysex: false });
    expect(midi.input).toBe(a.id);
    a.onmidimessage?.({ data: new Uint8Array([0x90, 60, 99]) });
    expect(midi.onEvent).toHaveBeenCalledWith({
      type: "on",
      pitch: 60,
      channel: 0,
    });
    midi.input = b.id;
    midi.bind();
    expect(a.onmidimessage).toBeNull();
    expect(b.onmidimessage).not.toBeNull();
    b.state = "disconnected";
    access.onstatechange?.();
    expect(midi.input).toBe(a.id);
    a.state = "disconnected";
    access.onstatechange?.();
    expect(midi.input).toBe("");
    expect(midi.message).toMatch(/No piano/);
    b.state = "connected";
    access.onstatechange?.();
    expect(midi.input).toBe(b.id);
    midi.dispose();
    expect(b.onmidimessage).toBeNull();
    expect(access.onstatechange).toBeNull();
  });
  it("never echoes input or feeds output to Follow me; clears scheduled output", async () => {
    const { a, out } = install();
    const midi = new MidiConnection();
    midi.onEvent = vi.fn();
    await midi.connect();
    midi.output = out.id;
    out.send.mockClear();
    a.onmidimessage?.({ data: new Uint8Array([0x90, 60, 99]) });
    expect(out.send).not.toHaveBeenCalled();
    midi.onEvent = vi.fn();
    midi.send([0x90, 64, 70], 0.5);
    expect(midi.onEvent).not.toHaveBeenCalled();
    expect(out.send).toHaveBeenCalledWith([0x90, 64, 70], expect.any(Number));
    midi.panic();
    expect(out.clear).toHaveBeenCalled();
    expect(out.send).toHaveBeenCalledWith([0xb0, 123, 0]);
    expect(out.send).toHaveBeenCalledWith([0xbf, 64, 0]);
  });
});
