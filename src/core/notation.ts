import {
  handList,
  secondsAt,
  unique,
  type Hand,
  type HandFilter,
  type Note,
  type Score,
  type Step,
  type Token,
} from "./model";
export function createSteps(
  score: Score,
  hand: HandFilter = "both",
  from = 0,
  to = score.end,
): Step[] {
  const notes = score.notes
    .filter(
      (n) =>
        (hand === "both" || n.hand === hand) && n.start < to && n.end > from,
    )
    .map((n) => ({
      ...n,
      start: Math.max(n.start, from),
      end: Math.min(n.end, to),
    }));
  const events = new Map<number, { on: Note[]; off: Note[] }>();
  for (const n of notes) {
    for (const [t, type] of [
      [n.start, "on"],
      [n.end, "off"],
    ] as const) {
      if (!events.has(t)) events.set(t, { on: [], off: [] });
      events.get(t)![type].push(n);
    }
  }
  const active: Record<Hand, Map<string, Note>> = {
    RH: new Map(),
    LH: new Map(),
  };
  const result: Step[] = [];
  for (const [tick, event] of [...events].sort((a, b) => a[0] - b[0])) {
    const step: Step = {
      tick,
      seconds: secondsAt(tick, score) - secondsAt(from, score),
      hands: { RH: [], LH: [] },
      before: { RH: [], LH: [] },
      after: { RH: [], LH: [] },
      attacks: { RH: [], LH: [] },
      releases: { RH: [], LH: [] },
    };
    for (const h of handList) {
      const state = active[h];
      const before = unique([...state.values()].map((n) => n.pitch));
      step.before[h] = before;
      for (const n of event.off.filter((n) => n.hand === h)) state.delete(n.id);
      const continuing = unique([...state.values()].map((n) => n.pitch));
      const newNotes = event.on.filter((n) => n.hand === h);
      const attacks = unique(newNotes.map((n) => n.pitch));
      const releases = before.filter(
        (p) => !continuing.includes(p) || attacks.includes(p),
      );
      for (const n of newNotes) state.set(n.id, n);
      const after = unique([...state.values()].map((n) => n.pitch));
      step.after[h] = after;
      step.attacks[h] = attacks;
      step.releases[h] = releases;
      let tokens: Token[] = [];
      if (!attacks.length && !releases.length) tokens = [{ action: "hold" }];
      else if (!after.length) tokens = [{ action: "rest" }];
      else if (attacks.length && !continuing.length)
        tokens = attacks.map((pitch) => ({ action: "replace", pitch }));
      else
        tokens = [
          ...releases
            .filter((p) => !attacks.includes(p))
            .map((pitch) => ({ action: "release" as const, pitch })),
          ...attacks.map((pitch) => ({ action: "add" as const, pitch })),
        ];
      step.hands[h] = tokens;
    }
    if (handList.some((h) => step.attacks[h].length || step.releases[h].length))
      result.push(step);
  }
  return result;
}
// Separate interpreter for translation verification. Does not inspect original notes.
export function interpret(tokens: Token[], held: number[]) {
  const state = new Set(held);
  const attacks: number[] = [],
    releases: number[] = [];
  if (tokens.some((t) => t.action === "replace")) {
    releases.push(...state);
    state.clear();
  }
  for (const t of tokens) {
    if (t.action === "rest") {
      releases.push(...state);
      state.clear();
    }
    if (t.action === "release" && t.pitch !== undefined) {
      if (state.delete(t.pitch)) releases.push(t.pitch);
    }
    if (
      (t.action === "replace" || t.action === "add") &&
      t.pitch !== undefined
    ) {
      if (state.has(t.pitch)) releases.push(t.pitch);
      state.add(t.pitch);
      attacks.push(t.pitch);
    }
  }
  return {
    held: unique([...state]),
    attacks: unique(attacks),
    releases: unique(releases),
  };
}
export function verifySteps(steps: Step[]) {
  const held: Record<Hand, number[]> = { RH: [], LH: [] };
  for (const [i, s] of steps.entries())
    for (const h of handList) {
      const r = interpret(s.hands[h], held[h]);
      for (const [a, b] of [
        [r.held, s.after[h]],
        [r.attacks, s.attacks[h]],
        [r.releases, s.releases[h]],
      ])
        if (JSON.stringify(a) !== JSON.stringify(b))
          throw Error(`Notation mismatch at step ${i + 1} (${h})`);
      held[h] = r.held;
    }
  return true;
}
export function activeAt(steps: Step[], seconds: number) {
  let lo = 0,
    hi = steps.length - 1,
    index = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (steps[mid].seconds <= seconds) {
      index = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return index;
}
