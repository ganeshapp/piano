export type Hand = "RH" | "LH";
export type HandFilter = "both" | Hand;
export type Mode = "listen" | "steady" | "follow";
export type Difficulty = "Beginner" | "Intermediate" | "Advanced" | "Unrated";
export interface Note {
  id: string;
  pitch: number;
  hand: Hand;
  start: number;
  end: number;
  part: string;
  staff: number;
  voice: string;
  measure: number;
  spelling: string;
  tie?: string[];
  velocity: number;
}
export interface Measure {
  index: number;
  number: string;
  start: number;
  end: number;
  source: number;
}
export interface Tempo {
  tick: number;
  bpm: number;
}
export interface Score {
  title: string;
  composer: string;
  notes: Note[];
  measures: Measure[];
  tempos: Tempo[];
  ppq: number;
  end: number;
  warnings: string[];
  defaultTempo: boolean;
  source: string;
  rights: string[];
  staffs: { key: string; name: string; hand: Hand | null }[];
}
export interface Token {
  action: "replace" | "add" | "release" | "hold" | "rest";
  pitch?: number;
}
export interface Step {
  tick: number;
  seconds: number;
  hands: Record<Hand, Token[]>;
  before: Record<Hand, number[]>;
  after: Record<Hand, number[]>;
  attacks: Record<Hand, number[]>;
  releases: Record<Hand, number[]>;
}
export interface Entry {
  arrangement?: string;
  id: string;
  title: string;
  composer: string;
  file: string;
  difficulty: Difficulty;
  basis: string;
  difficultySource?: string;
  status: "ready" | "review" | "error";
  warnings: string[];
  source: string;
  rights: string[];
  measures: number;
  notes: number;
  seconds: number;
  local?: boolean;
}
export const handList: Hand[] = ["RH", "LH"];
export const noteName = (p: number) =>
  ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][
    ((p % 12) + 12) % 12
  ] +
  (Math.floor(p / 12) - 1);
export const black = (p: number) => [1, 3, 6, 8, 10].includes(p % 12);
export function secondsAt(
  tick: number,
  score: Pick<Score, "tempos" | "ppq">,
): number {
  let seconds = 0,
    prev = 0,
    bpm = 120;
  for (const t of score.tempos) {
    if (t.tick > tick) break;
    seconds += (((t.tick - prev) / score.ppq) * 60) / bpm;
    prev = t.tick;
    bpm = t.bpm;
  }
  return seconds + (((tick - prev) / score.ppq) * 60) / bpm;
}
export const unique = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);
