import { describe, it, expect, vi } from "vitest";
import { PianoAudio } from "../src/core/audio";
function setup(native = false) {
  const params: Array<Record<string, ReturnType<typeof vi.fn>>> = [];
  const oscillators: Array<{ stop: ReturnType<typeof vi.fn> }> = [];
  const context = {
    currentTime: 0,
    destination: {},
    createPeriodicWave: vi.fn(),
    createGain: () => {
      const param = {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
        setTargetAtTime: vi.fn(),
        ...(native ? { cancelAndHoldAtTime: vi.fn() } : {}),
      };
      params.push(param);
      return { gain: param, connect: vi.fn() };
    },
    createOscillator: () => {
      const osc = {
        frequency: { value: 0 },
        setPeriodicWave: vi.fn(),
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      };
      oscillators.push(osc);
      return osc;
    },
  };
  const audio = new PianoAudio();
  audio.context = context as unknown as AudioContext;
  return { audio, context, params, oscillators };
}
describe("browser-compatible audio releases", () => {
  it("uses native hold cancellation when available", () => {
    const { audio, params } = setup(true);
    audio.on(60, 0);
    audio.off(60, 0.4);
    expect(params[0].cancelAndHoldAtTime).toHaveBeenCalledWith(0.4);
    expect(params[0].cancelScheduledValues).not.toHaveBeenCalled();
  });
  it.each([0.003, 0.4, 2, 10])(
    "releases without cancelAndHoldAtTime at %s seconds",
    (time) => {
      const { audio, params, oscillators } = setup();
      audio.on(60, 0);
      expect(() => audio.off(60, time)).not.toThrow();
      expect(params[0].cancelScheduledValues).toHaveBeenCalledWith(time);
      expect(params[0].setTargetAtTime).toHaveBeenCalledWith(
        0.00001,
        time,
        0.035,
      );
      expect(oscillators[0].stop).toHaveBeenLastCalledWith(time + 0.18);
      if (time === 0.003)
        expect(
          params[0].linearRampToValueAtTime.mock.lastCall?.[0],
        ).toBeCloseTo((0.12 * 72) / 127 / 2, 12);
      if (time === 0.4) {
        const peak = (0.12 * 72) / 127;
        expect(
          params[0].exponentialRampToValueAtTime.mock.lastCall?.[0],
        ).toBeCloseTo(peak * (0.015 / peak) ** ((time - 0.006) / 0.794), 12);
      }
    },
  );
  it("preserves scheduled timing, handles reattacks and clears every voice", () => {
    const { audio, params, oscillators } = setup();
    audio.on(60, 1);
    audio.on(60, 1.5);
    audio.off(60, 2);
    expect(params[0].cancelScheduledValues).toHaveBeenCalledWith(1.5);
    expect(params[1].cancelScheduledValues).toHaveBeenCalledWith(2);
    audio.stop();
    for (const p of params)
      expect(p.cancelScheduledValues).toHaveBeenLastCalledWith(0);
    for (const o of oscillators) expect(o.stop).toHaveBeenLastCalledWith();
  });
});
