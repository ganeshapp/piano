import { describe, it, expect, vi, afterEach } from "vitest";
import { parseScore, decodeScore } from "../src/core/xml";
import { createSteps, interpret, verifySteps } from "../src/core/notation";
import { Follower, decodeMidi } from "../src/core/follow";
import { noteName, secondsAt, type Score, type Note } from "../src/core/model";
import { playbackTimes, Transport } from "../src/core/transport";
import { PianoAudio } from "../src/core/audio";
import { zipSync, strToU8 } from "fflate";
export const wrap = (body: string, div = 1) =>
  `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>Fixture</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>${div}</divisions><staves>2</staves><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${body}</measure></part></score-partwise>`;
const note = (p: string, d = 1, staff = 1, extra = "") =>
  `<note>${extra}<pitch><step>${p[0]}</step><octave>${p.slice(1)}</octave></pitch><duration>${d}</duration><staff>${staff}</staff></note>`;
const endMeasure = '</measure><measure number="2">';
const raw = (notes: Partial<Note>[]): Score => ({
  title: "Fixture",
  composer: "",
  ppq: 1,
  end: 8,
  tempos: [{ tick: 0, bpm: 60 }],
  measures: [{ index: 0, number: "1", start: 0, end: 8, source: 0 }],
  warnings: [],
  defaultTempo: false,
  source: "",
  rights: [],
  staffs: [],
  notes: notes.map((n, i) => ({
    id: String(i),
    pitch: 60,
    hand: "RH",
    start: 0,
    end: 1,
    part: "P1",
    staff: 1,
    voice: "1",
    measure: 0,
    spelling: "C4",
    velocity: 72,
    ...n,
  })),
});
const input = (f: Follower, pitch: number, type: "on" | "off" = "on") =>
  f.input({ type, pitch, channel: 0 });
describe("MusicXML interpretation", () => {
  it("parses simultaneous hands/chords and correct addresses", () => {
    const s = parseScore(
      wrap(
        note("C4") +
          "<backup><duration>1</duration></backup>" +
          note("C3", 2, 2) +
          note("G3", 2, 2, "<chord/>"),
      ),
    );
    expect(s.notes.map((n) => [n.pitch, n.hand, n.start])).toEqual([
      [48, "LH", 0],
      [55, "LH", 0],
      [60, "RH", 0],
    ]);
    expect(noteName(60)).toBe("C4");
    expect(noteName(21)).toBe("A0");
    expect(noteName(108)).toBe("C8");
  });
  it("reads flats and enharmonic octave boundaries from pitch", () => {
    const s = parseScore(
      wrap(
        note("B3", 1, 1).replace("</step>", "</step><alter>1</alter>") +
          note("C4").replace("</step>", "</step><alter>-1</alter>"),
      ),
    );
    expect(s.notes.map((n) => noteName(n.pitch))).toEqual(["C4", "B3"]);
  });
  it("keeps fractional triplet times exact", () => {
    const s = parseScore(
      wrap(note("C4", 2) + note("D4", 2) + note("E4", 2), 6),
    );
    expect(s.notes.map((n) => n.start)).toEqual([0, 8, 16]);
    expect(s.notes.map((n) => n.end)).toEqual([8, 16, 24]);
  });
  it("merges a tie across measures into one attack", () => {
    const s = parseScore(
      wrap(
        note("C4", 4, 1, '<tie type="start"/>') +
          endMeasure +
          note("C4", 4, 1, '<tie type="stop"/>'),
      ),
    );
    expect(s.notes).toHaveLength(1);
    expect(s.notes[0].end).toBe(32);
    expect(createSteps(s)).toHaveLength(2);
  });
  it("preserves a repeated untied pitch as two attacks", () => {
    const s = parseScore(wrap(note("C4") + note("C4")));
    expect(createSteps(s).filter((t) => t.attacks.RH.length)).toHaveLength(2);
  });
  it("keeps initial rests and final note release", () => {
    const s = parseScore(
      wrap("<note><rest/><duration>1</duration></note>" + note("C4", 3)),
    );
    const steps = createSteps(s);
    expect(steps[0].seconds).toBe(0.5);
    expect(steps.at(-1)?.seconds).toBe(2);
    expect(s.end).toBe(16);
  });
  it("applies changing tempo, including inherited tempo", () => {
    const s = parseScore(
      wrap(
        '<direction><sound tempo="60"/></direction>' +
          note("C4", 4) +
          endMeasure +
          '<direction><sound tempo="120"/></direction>' +
          note("D4", 4),
      ),
    );
    expect(secondsAt(s.end, s)).toBe(6);
    expect(s.defaultTempo).toBe(false);
  });
  it("expands ordinary repeats without infinite traversal", () => {
    const s = parseScore(
      wrap(
        '<barline location="left"><repeat direction="forward"/></barline>' +
          note("C4", 4) +
          endMeasure +
          note("D4", 4) +
          '<barline><repeat direction="backward"/></barline>',
      ),
    );
    expect(s.measures.map((m) => m.number)).toEqual(["1", "2", "1", "2"]);
    expect(s.notes.map((n) => n.pitch)).toEqual([60, 62, 60, 62]);
  });
  it("plays first and second endings correctly", () => {
    const s = parseScore(
      wrap(
        '<barline location="left"><repeat direction="forward"/></barline>' +
          note("C4", 4) +
          endMeasure +
          '<barline location="left"><ending number="1" type="start"/></barline>' +
          note("D4", 4) +
          '<barline><ending number="1" type="stop"/><repeat direction="backward"/></barline></measure><measure number="3"><barline location="left"><ending number="2" type="start"/></barline>' +
          note("E4", 4) +
          '<barline><ending number="2" type="stop"/></barline>',
      ),
    );
    expect(s.notes.map((n) => n.pitch)).toEqual([60, 62, 60, 64]);
  });
  it("flags omitted grace notes and extra staves", () => {
    const s = parseScore(
      wrap(note("D4", 0, 1, "<grace/>") + note("C4", 4) + note("C5", 4, 3)),
    );
    expect(s.notes).toHaveLength(1);
    expect(s.warnings.join(" ")).toMatch(/Grace/);
    expect(s.warnings.join(" ")).toMatch(/extra staves/);
  });
  it("honors explicit hand overrides and exclusions", () => {
    const s = parseScore(wrap(note("C4", 4) + note("C5", 4, 3)), {
      mapping: { "P1:1": "LH", "P1:2": null, "P1:3": null },
    });
    expect(s.notes[0].hand).toBe("LH");
    expect(s.notes).toHaveLength(1);
  });
  it("rejects malformed files, entity declarations and unsupported roots", () => {
    expect(() => parseScore("<score-partwise><note>")).toThrow();
    expect(() =>
      parseScore('<!DOCTYPE a [<!ENTITY x "hi">]><score-partwise/>'),
    ).toThrow(/entity/);
    expect(() => parseScore("<score-timewise/>")).toThrow(/partwise/);
  });
  it("unpacks compressed MusicXML and rejects invalid archives", () => {
    const xml = wrap(note("C4"));
    const bytes = zipSync({
      "META-INF/container.xml": strToU8(
        '<container><rootfiles><rootfile full-path="score.xml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>',
      ),
      "score.xml": strToU8(xml),
    });
    expect(decodeScore(bytes)).toBe(xml);
    expect(() => decodeScore(new Uint8Array([80, 75, 0, 0]))).toThrow();
    expect(() => decodeScore(zipSync({ "wrong.xml": strToU8(xml) }))).toThrow(
      /manifest/,
    );
  });
});
describe("action notation", () => {
  it("selectively releases a moving line over a held note", () => {
    const s = raw([
      { pitch: 60, end: 4 },
      { pitch: 64, start: 1, end: 2 },
      { pitch: 67, start: 2, end: 3 },
      { pitch: 65, start: 3, end: 4 },
    ]);
    const steps = createSteps(s);
    expect(steps.map((s) => s.hands.RH)).toEqual([
      [{ action: "replace", pitch: 60 }],
      [{ action: "add", pitch: 64 }],
      [
        { action: "release", pitch: 64 },
        { action: "add", pitch: 67 },
      ],
      [
        { action: "release", pitch: 67 },
        { action: "add", pitch: 65 },
      ],
      [{ action: "rest" }],
    ]);
    expect(verifySteps(steps)).toBe(true);
  });
  it("red repeated notes create a new attack while preserving other keys", () => {
    const s = raw([
      { pitch: 48, end: 3 },
      { pitch: 60, end: 1 },
      { pitch: 60, start: 1, end: 2 },
    ]);
    const steps = createSteps(s);
    expect(steps[1].hands.RH).toEqual([{ action: "add", pitch: 60 }]);
    expect(interpret(steps[1].hands.RH, [48, 60])).toEqual({
      held: [48, 60],
      attacks: [60],
      releases: [60],
    });
    expect(verifySteps(steps)).toBe(true);
  });
  it("includes release-only events and simultaneous two-hand actions", () => {
    const steps = createSteps(
      raw([
        { pitch: 60, end: 2 },
        { pitch: 48, hand: "LH", end: 0.5 },
      ]),
    );
    expect(steps.map((s) => s.tick)).toEqual([0, 0.5, 2]);
    expect(steps[1].hands.LH).toEqual([{ action: "rest" }]);
    expect(steps[1].hands.RH).toEqual([{ action: "hold" }]);
  });
  it("hand filtering drops irrelevant practice steps but preserves timestamps", () => {
    const s = raw([
      { pitch: 60, end: 2 },
      { pitch: 48, hand: "LH", start: 0.5, end: 1 },
    ]);
    expect(createSteps(s, "RH").map((s) => s.tick)).toEqual([0, 2]);
    expect(createSteps(s, "LH").map((s) => s.tick)).toEqual([0.5, 1]);
  });
  it("restores notes held at the start of a passage and releases at its end", () => {
    const steps = createSteps(
      raw([
        { pitch: 60, end: 7 },
        { pitch: 67, start: 4, end: 6 },
      ]),
      "both",
      3,
      5,
    );
    expect(steps[0].hands.RH).toEqual([{ action: "replace", pitch: 60 }]);
    expect(steps[0].seconds).toBe(0);
    expect(steps.at(-1)?.after.RH).toEqual([]);
    expect(steps.at(-1)?.tick).toBe(5);
    expect(verifySteps(steps)).toBe(true);
  });
  it("keeps overlapping physical pitch held until every identity ends", () => {
    const steps = createSteps(
      raw([
        { pitch: 60, end: 3 },
        { pitch: 60, start: 1, end: 2 },
      ]),
    );
    expect(steps.map((s) => s.tick)).toEqual([0, 1, 3]);
    expect(verifySteps(steps)).toBe(true);
  });
  it("reconstructs arbitrary step state independently", () => {
    const steps = createSteps(
      raw([
        { pitch: 60, end: 3 },
        { pitch: 67, start: 1, end: 2 },
      ]),
    );
    let held: number[] = [];
    for (const step of steps) {
      held = interpret(step.hands.RH, held).held;
      expect(held).toEqual(step.after.RH);
    }
  });
  it("uses distinct original and evenly spaced times", () => {
    const steps = createSteps(
      raw([
        { pitch: 60, start: 1, end: 4 },
        { pitch: 64, start: 4, end: 4.5 },
      ]),
    );
    expect(playbackTimes(steps, false, 1)).toEqual([1, 4, 4.5]);
    expect(playbackTimes(steps, true, 1)).toEqual([0, 1, 2]);
  });
});
describe("MIDI Follow me", () => {
  it("decodes velocity-zero note-on and sustain independently", () => {
    expect(decodeMidi([0x93, 60, 0])).toEqual({
      type: "off",
      pitch: 60,
      channel: 3,
    });
    expect(decodeMidi([0xb2, 64, 127])).toEqual({
      type: "pedal",
      down: true,
      channel: 2,
    });
    expect(decodeMidi([0xe0, 60, 127])).toBeNull();
  });
  it("accepts a staggered chord when every new note is down", () => {
    const f = new Follower(
      createSteps(raw([{ pitch: 60 }, { pitch: 64 }, { pitch: 67 }])),
    );
    expect(input(f, 60)).toBe(false);
    expect(input(f, 64)).toBe(false);
    expect(input(f, 67)).toBe(true);
    expect(f.done).toBe(true);
  });
  it("does not accept a chord if one key was released too soon", () => {
    const f = new Follower(createSteps(raw([{ pitch: 60 }, { pitch: 64 }])));
    input(f, 60);
    input(f, 60, "off");
    input(f, 64);
    expect(f.done).toBe(false);
    input(f, 60);
    expect(f.done).toBe(true);
  });
  it("allows correction of wrong notes without restarting", () => {
    const f = new Follower(createSteps(raw([{ pitch: 60 }])));
    input(f, 61);
    input(f, 60);
    expect(f.done).toBe(false);
    expect([...f.wrong]).toEqual([61]);
    input(f, 61, "off");
    expect(f.done).toBe(true);
  });
  it("does not consume one physical attack twice", () => {
    const f = new Follower(
      createSteps(
        raw([
          { pitch: 60, end: 1 },
          { pitch: 60, start: 1, end: 2 },
        ]),
      ),
    );
    input(f, 60);
    expect(f.done).toBe(false);
    input(f, 60);
    expect(f.done).toBe(false);
    input(f, 60, "off");
    input(f, 60);
    expect(f.done).toBe(true);
  });
  it("automatically passes release-only steps", () => {
    const f = new Follower(
      createSteps(
        raw([
          { pitch: 60, end: 0.5 },
          { pitch: 64, start: 1, end: 2 },
        ]),
      ),
    );
    input(f, 60);
    expect(f.expected).toEqual([64]);
    input(f, 64);
    expect(f.done).toBe(true);
  });
  it("does not treat pedal as a held key", () => {
    const f = new Follower(createSteps(raw([{ pitch: 60 }, { pitch: 64 }])));
    input(f, 60);
    f.input({ type: "pedal", channel: 0, down: true });
    input(f, 60, "off");
    expect(f.pedal).toBe(true);
    expect(f.pressed.has(60)).toBe(false);
  });
  it("tracks different input channels independently", () => {
    const f = new Follower([]);
    f.input({ type: "on", pitch: 60, channel: 1 });
    f.input({ type: "on", pitch: 60, channel: 2 });
    f.input({ type: "off", pitch: 60, channel: 1 });
    expect(f.pressed.has(60)).toBe(true);
    f.resetInput();
    expect(f.pressed.size).toBe(0);
  });
});
describe("transport scheduling and cleanup", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("cancels sound on pause, restores a mid-note seek, and stops scheduling", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    let now = 0;
    const on = vi.fn(),
      off = vi.fn(),
      stop = vi.fn();
    const audio = {
      get now() {
        return now;
      },
      init: async () => {},
      on,
      off,
      stop,
    } as unknown as PianoAudio;
    const t = new Transport(audio);
    t.configure(createSteps(raw([{ pitch: 60, end: 4 }])), false, 1, 4);
    await t.play();
    expect(on).toHaveBeenCalledWith(60, 0);
    now = 1;
    t.pause();
    expect(t.position).toBe(1);
    expect(stop).toHaveBeenCalled();
    on.mockClear();
    await t.play();
    expect(on).toHaveBeenCalledWith(60, 1);
    t.stop();
    const count = on.mock.calls.length;
    now = 10;
    vi.advanceTimersByTime(1000);
    expect(on).toHaveBeenCalledTimes(count);
    expect(t.position).toBe(0);
  });
});
describe("transport races and loops", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("does not start after a stop while audio permission is pending", async () => {
    vi.stubGlobal("cancelAnimationFrame", () => {});
    let resolve!: () => void;
    const on = vi.fn(),
      stop = vi.fn();
    const audio = {
      now: 0,
      init: () => new Promise<void>((r) => (resolve = r)),
      on,
      off: vi.fn(),
      stop,
    } as unknown as PianoAudio;
    const t = new Transport(audio);
    t.configure(createSteps(raw([{ pitch: 60, end: 1 }])), false, 1, 1);
    const pending = t.play();
    t.stop();
    resolve();
    await pending;
    expect(t.running).toBe(false);
    expect(on).not.toHaveBeenCalled();
  });
  it("clears stale sound and schedules the initial setup again when looping", async () => {
    vi.useFakeTimers();
    let frame: () => void = () => {};
    vi.stubGlobal("requestAnimationFrame", (fn: () => void) => {
      frame = fn;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    let now = 0;
    const on = vi.fn(),
      stop = vi.fn();
    const audio = {
      get now() {
        return now;
      },
      init: async () => {},
      on,
      off: vi.fn(),
      stop,
    } as unknown as PianoAudio;
    const t = new Transport(audio);
    t.configure(
      createSteps(raw([{ pitch: 60, end: 2 }]), "both", 1, 2),
      false,
      1,
      1,
    );
    t.loop = true;
    await t.play();
    now = 1.01;
    frame();
    await Promise.resolve();
    await Promise.resolve();
    expect(stop).toHaveBeenCalled();
    expect(on).toHaveBeenCalledTimes(2);
    expect(t.running).toBe(true);
    t.stop();
  });
});
