import { DOMParser } from "@xmldom/xmldom";
import { unzipSync, strFromU8 } from "fflate";
import type { Hand, Note, Score, Tempo } from "./model";
const LIMIT = 24 * 1024 * 1024;
type El = Element;
const children = (e: El, tag?: string): El[] =>
  Array.from(e.childNodes).filter(
    (n): n is El => n.nodeType === 1 && (!tag || n.nodeName === tag),
  );
const child = (e: El, tag: string) => children(e, tag)[0];
const text = (e: El | undefined, tag?: string): string =>
  (tag ? e && child(e, tag) : e)?.textContent?.trim() || "";
const num = (e: El | undefined, tag: string, fallback = 0) => {
  const s = text(e, tag);
  return s === "" ? fallback : Number(s);
};
const descendants = (e: El, tag: string): El[] =>
  Array.from(e.getElementsByTagName(tag));
function document(xml: string) {
  if (xml.length > LIMIT)
    throw Error("This score is too large (24 MB maximum).");
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(xml))
    throw Error("XML entity declarations are not supported.");
  const errors: string[] = [];
  const doc = new DOMParser({
    errorHandler: {
      warning: (m) => errors.push(m),
      error: (m) => errors.push(m),
      fatalError: (m) => errors.push(m),
    },
  }).parseFromString(xml.replace(/<!DOCTYPE[^>]*>/gi, ""), "application/xml");
  if (errors.length || !doc.documentElement)
    throw Error("This file is not valid MusicXML. Please export it again.");
  return doc.documentElement as unknown as El;
}
export function decodeScore(bytes: Uint8Array): string {
  if (bytes.byteLength > LIMIT)
    throw Error("Choose a MusicXML file smaller than 24 MB.");
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return strFromU8(bytes);
  let total = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (f) => {
        total += f.originalSize;
        if (total > LIMIT || f.originalSize > LIMIT)
          throw Error("Expanded archive is too large.");
        return true;
      },
    });
  } catch {
    throw Error(
      "The MXL archive is damaged or exceeds the 24 MB expanded limit.",
    );
  }
  const container = entries["META-INF/container.xml"];
  if (!container) throw Error("The MXL archive has no score manifest.");
  const root = document(strFromU8(container));
  const files = descendants(root, "rootfile");
  const path = (
    files.find(
      (f) =>
        f.getAttribute("media-type") ===
        "application/vnd.recordare.musicxml+xml",
    ) || files[0]
  )?.getAttribute("full-path");
  if (!path || !entries[path])
    throw Error("The MXL archive is missing its main score.");
  return strFromU8(entries[path]);
}
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
export interface ImportOptions {
  mapping?: Record<string, Hand | null>;
  title?: string;
}
interface RawMeasure {
  number: string;
  length: number;
  notes: Note[];
  tempos: Tempo[];
  forward: boolean;
  backward: number;
  endings: number[];
}
export function parseScore(xml: string, options: ImportOptions = {}): Score {
  const root = document(xml);
  if (root.nodeName !== "score-partwise")
    throw Error(
      "Please export a partwise MusicXML score. This file uses an unsupported score format.",
    );
  const warnings = new Set<string>();
  let ppq = 1;
  for (const d of descendants(root, "divisions")) {
    const n = Number(text(d));
    if (!Number.isInteger(n) || n <= 0)
      throw Error("Invalid rhythmic divisions in this score.");
    ppq = (ppq / gcd(ppq, n)) * n;
    if (ppq > 10000000)
      throw Error("This score has excessively complex timing divisions.");
  }
  ppq *= 4; // also represents ordinary time-signature denominators exactly
  const parts = children(root, "part");
  if (!parts.length) throw Error("No musical parts were found.");
  const partDefs = new Map(
    descendants(root, "score-part").map((p) => [
      p.getAttribute("id"),
      text(p, "part-name"),
    ]),
  );
  const staffs: Score["staffs"] = [];
  for (const part of parts) {
    const id = part.getAttribute("id") || "P1";
    const declared = Math.max(
      1,
      ...descendants(part, "staves").map((s) => Number(text(s))),
    );
    const observed = descendants(part, "note").map((n) => num(n, "staff", 1));
    const count = Math.max(declared, ...observed);
    for (let s = 1; s <= count; s++) {
      const key = `${id}:${s}`;
      const inferred: Hand | null =
        part === parts[0] ? (s === 1 ? "RH" : s === 2 ? "LH" : null) : null;
      staffs.push({
        key,
        name: `${partDefs.get(id) || id} · staff ${s}`,
        hand:
          options.mapping && key in options.mapping
            ? options.mapping[key]
            : inferred,
      });
    }
  }
  if (!options.mapping && (parts.length > 1 || staffs.length > 2))
    warnings.add(
      "Hand assignment needs review: multiple parts or extra staves. Only the first part’s first two staves are selected.",
    );
  if (staffs.length === 1 && !options.mapping)
    warnings.add(
      "Only one staff: assigned to the right hand. Verify the hand mapping.",
    );
  const unsupported: [string, string][] = [
    ["grace", "Grace notes are omitted in this preview."],
    ["ornaments", "Ornaments are not expanded in this preview."],
    ["arpeggiate", "Rolled chords are played together in this preview."],
    [
      "pedal",
      "Pedal markings are not performed; key releases follow written durations.",
    ],
    [
      "octave-shift",
      "Octave-shift lines need review; written pitch is used in this preview.",
    ],
    ["transpose", "Transposing instruments are not supported."],
    ["glissando", "Glissandos are not expanded in this preview."],
    ["tremolo", "Tremolos are not expanded in this preview."],
  ];
  for (const [tag, message] of unsupported)
    if (descendants(root, tag).length) warnings.add(message);
  for (const s of descendants(root, "sound"))
    if (
      ["dacapo", "dalsegno", "tocoda", "fine", "segno", "coda"].some((a) =>
        s.hasAttribute(a),
      )
    )
      warnings.add(
        "Navigation jumps (D.C./D.S./coda) need review; this preview uses ordinary repeats only.",
      );
  const raw: RawMeasure[] = [];
  let noteId = 0;
  let declaredTempo = false;
  for (const part of parts) {
    let div = 1,
      beats = 4,
      beatType = 4;
    const pid = part.getAttribute("id") || "P1";
    let activeEnding: number[] = [];
    children(part, "measure").forEach((measure, mi) => {
      let cursor = 0,
        max = 0,
        lastStart = 0;
      const localNotes: Note[] = [];
      const localTempos: Tempo[] = [];
      let forward = false,
        backward = 0;
      let endingThis = [...activeEnding];
      for (const bar of children(measure, "barline"))
        for (const e of children(bar, "ending"))
          if (e.getAttribute("type") === "start") {
            activeEnding = (e.getAttribute("number") || "")
              .split(/[, ]+/)
              .map(Number)
              .filter(Number.isFinite);
            endingThis = [...activeEnding];
          }
      for (const e of children(measure)) {
        if (e.nodeName === "attributes") {
          div = num(e, "divisions", div);
          const time = child(e, "time");
          if (time) {
            const bs = text(time, "beats");
            beats = bs.split("+").reduce((a, b) => a + Number(b), 0) || beats;
            beatType = num(time, "beat-type", beatType);
          }
        }
        const units = (x: El, tag = "duration") => {
          const value = (num(x, tag) * ppq) / div;
          if (
            !Number.isFinite(value) ||
            Math.abs(value - Math.round(value)) > 1e-6
          )
            throw Error("Unsupported fractional MusicXML timing.");
          return Math.round(value);
        };
        if (e.nodeName === "backup") cursor -= units(e);
        if (e.nodeName === "forward") {
          cursor += units(e);
          max = Math.max(max, cursor);
        }
        if (e.nodeName === "direction") {
          const sound = child(e, "sound");
          let bpm = Number(sound?.getAttribute("tempo") || 0);
          const metro = descendants(e, "metronome")[0];
          if (!bpm && metro) {
            const unit = text(metro, "beat-unit");
            const scale: Record<string, number> = {
              whole: 4,
              half: 2,
              quarter: 1,
              eighth: 0.5,
              "16th": 0.25,
            };
            bpm =
              num(metro, "per-minute") *
              (scale[unit] || 1) *
              (child(metro, "beat-unit-dot") ? 1.5 : 1);
          }
          if (bpm > 0 && bpm < 1000) {
            localTempos.push({
              tick: Math.max(0, cursor + units(e, "offset")),
              bpm,
            });
            declaredTempo = true;
          }
        }
        if (e.nodeName === "sound" && Number(e.getAttribute("tempo")) > 0) {
          localTempos.push({
            tick: cursor,
            bpm: Number(e.getAttribute("tempo")),
          });
          declaredTempo = true;
        }
        if (e.nodeName === "barline")
          for (const rep of children(e, "repeat")) {
            if (rep.getAttribute("direction") === "forward") forward = true;
            else backward = Number(rep.getAttribute("times") || 2);
          }
        if (e.nodeName !== "note") continue;
        if (child(e, "grace")) continue;
        const duration = units(e);
        if (duration < 0) throw Error("A note has negative duration.");
        const chord = !!child(e, "chord");
        const start = chord ? lastStart : cursor;
        if (!chord) {
          lastStart = start;
          cursor += duration;
        }
        max = Math.max(max, cursor, start + duration);
        if (child(e, "rest") || !child(e, "pitch")) continue;
        const staff = num(e, "staff", 1);
        const hand = staffs.find((s) => s.key === `${pid}:${staff}`)?.hand;
        if (!hand) continue;
        const pitch = child(e, "pitch");
        const letter = text(pitch, "step");
        const octave = num(pitch, "octave", 4);
        const alter = num(pitch, "alter");
        const semitone = (
          { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as Record<
            string,
            number
          >
        )[letter];
        const midi = (octave + 1) * 12 + semitone + alter;
        if (!Number.isInteger(midi) || midi < 21 || midi > 108) {
          warnings.add(
            "Notes outside the 88-key range or microtones are omitted.",
          );
          continue;
        }
        if (duration === 0) continue;
        localNotes.push({
          id: `n${noteId++}`,
          pitch: midi,
          hand,
          start,
          end: start + duration,
          part: pid,
          staff,
          voice: text(e, "voice") || "1",
          measure: mi,
          spelling: `${letter}${alter === -1 ? "b" : alter === 1 ? "#" : ""}${octave}`,
          tie: children(e, "tie").map((t) => t.getAttribute("type") || ""),
          velocity: 72,
        });
      }
      const expected = ((beats * 4) / beatType) * ppq;
      const length =
        measure.getAttribute("implicit") === "yes" ||
        (mi === 0 && max > 0 && max < expected)
          ? max
          : Math.max(max, expected);
      if (!Number.isInteger(length) || length <= 0)
        throw Error("A measure has invalid timing.");
      if (!raw[mi])
        raw[mi] = {
          number: measure.getAttribute("number") || String(mi + 1),
          length,
          notes: [],
          tempos: [],
          forward,
          backward,
          endings: endingThis,
        };
      else raw[mi].length = Math.max(raw[mi].length, length);
      raw[mi].notes.push(...localNotes);
      if (part === parts[0]) raw[mi].tempos.push(...localTempos);
      for (const e of descendants(measure, "ending"))
        if (["stop", "discontinue"].includes(e.getAttribute("type") || ""))
          activeEnding = [];
    });
  }
  if (!raw.length) throw Error("No measures were found.");
  let repeatOpen = false;
  for (const m of raw) {
    if (m.forward) {
      if (repeatOpen)
        warnings.add(
          "Nested repeat structure needs review; this preview supports simple repeat sections.",
        );
      repeatOpen = true;
    }
    if (m.backward) {
      if (!Number.isInteger(m.backward) || m.backward > 8)
        warnings.add(
          "Unusual repeat counts are limited to eight passes in this preview.",
        );
      repeatOpen = false;
    }
    if (m.endings.some((e) => e < 1 || e > 2))
      warnings.add("Endings beyond first and second need review.");
  }
  for (const part of parts) {
    const voices = new Map<string, Set<number>>();
    for (const n of descendants(part, "note")) {
      if (child(n, "rest")) continue;
      const voice = text(n, "voice");
      if (!voice) continue;
      const set = voices.get(voice) || new Set<number>();
      set.add(num(n, "staff", 1));
      voices.set(voice, set);
    }
    if ([...voices.values()].some((s) => s.size > 1))
      warnings.add(
        "A voice moves between staves. Hand assignment follows the displayed staff; crossed-hand passages need review.",
      );
  }
  if (descendants(root, "fermata").length)
    warnings.add(
      "Fermata pauses use the written duration; expressive extra time is not added.",
    );
  // Expand ordinary repeats with numbered endings. Track pass on both the repeat body and its exit ending.
  const order: number[] = [];
  let i = 0,
    repeatStart = 0,
    pass = 1,
    exitPass = 1,
    active = false;
  let budget = 0;
  while (i < raw.length && budget++ < 10000) {
    const m = raw[i];
    if (m.forward && !active) {
      repeatStart = i;
      pass = 1;
      active = true;
    }
    const p = active ? pass : exitPass;
    const include = !m.endings.length || m.endings.includes(p);
    if (include) order.push(i);
    if (m.backward) {
      const times = Math.min(8, Math.max(2, m.backward));
      if (pass < times) {
        pass++;
        exitPass = pass;
        active = true;
        i = repeatStart;
        continue;
      }
      exitPass = pass;
      active = false;
      pass = 1;
      repeatStart = i + 1;
    }
    if (!m.endings.length && !active) exitPass = 1;
    i++;
  }
  if (budget >= 10000)
    throw Error("Repeat structure exceeded the safe playback limit.");
  const notes: Note[] = [];
  const measures: Score["measures"] = [];
  const tempos: Tempo[] = [{ tick: 0, bpm: 120 }];
  let pos = 0;
  const sourceTempo: number[] = [];
  let bpm = 120;
  for (const m of raw) {
    sourceTempo.push(bpm);
    for (const t of m.tempos) bpm = t.bpm;
  }
  const ties = new Map<string, Note>();
  for (let occurrence = 0; occurrence < order.length; occurrence++) {
    const source = order[occurrence],
      m = raw[source];
    if (occurrence > 0 && source !== order[occurrence - 1] + 1)
      tempos.push({ tick: pos, bpm: sourceTempo[source] });
    measures.push({
      index: occurrence,
      number: m.number,
      start: pos,
      end: pos + m.length,
      source,
    });
    for (const t of m.tempos) tempos.push({ tick: pos + t.tick, bpm: t.bpm });
    for (const n of m.notes) {
      const copy = {
        ...n,
        id: `${n.id}@${occurrence}`,
        start: pos + n.start,
        end: pos + n.end,
        measure: occurrence,
      };
      const key = `${n.part}:${n.voice}:${n.pitch}:${n.hand}`;
      const prev = ties.get(key);
      if (n.tie?.includes("stop") && prev && prev.end === copy.start) {
        prev.end = copy.end;
        if (!n.tie.includes("start")) ties.delete(key);
      } else {
        if (n.tie?.includes("stop"))
          warnings.add("An unmatched tie needs review.");
        notes.push(copy);
        if (n.tie?.includes("start")) ties.set(key, copy);
        else ties.delete(key);
      }
    }
    pos += m.length;
  }
  if (ties.size) warnings.add("An unfinished tie needs review.");
  if (!notes.length)
    throw Error("No playable piano notes were found in the selected staves.");
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const playing = new Map<string, Note>();
  for (const n of notes) {
    const key = `${n.hand}:${n.pitch}`,
      prev = playing.get(key);
    if (prev && prev.end > n.start)
      warnings.add(
        "Overlapping voices share a physical key; their combined hold is used. Verify this passage.",
      );
    if (!prev || n.end > prev.end) playing.set(key, n);
  }
  const identification = child(root, "identification");
  const creators = identification ? children(identification, "creator") : [];
  const title =
    text(child(root, "work"), "work-title") ||
    text(root, "movement-title") ||
    options.title ||
    "Imported piece";
  return {
    title,
    composer: text(creators.find((c) => c.getAttribute("type") === "composer")),
    notes,
    measures,
    tempos: tempos.sort((a, b) => a.tick - b.tick),
    ppq,
    end: pos,
    warnings: [...warnings],
    defaultTempo: !declaredTempo,
    source: text(identification, "source"),
    rights: identification
      ? children(identification, "rights").map((r) => text(r))
      : [],
    staffs,
  };
}
