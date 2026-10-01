import { it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { parseScore, decodeScore } from "../src/core/xml";
import { createSteps, verifySteps } from "../src/core/notation";
import type { Entry } from "../src/core/model";
const entries: Entry[] = JSON.parse(
  readFileSync("public/catalog.json", "utf8"),
);
it("accounts for every bundled source file and keeps provenance", () => {
  expect(entries).toHaveLength(readdirSync("public/scores").length);
  expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
  for (const e of entries) {
    expect(e.source).toMatch(/^https?:/);
    expect(e.basis.length).toBeGreaterThan(10);
  }
});
for (const entry of entries)
  it(`round trips ${entry.title} (${entry.id})`, () => {
    const score = parseScore(decodeScore(readFileSync(`public/${entry.file}`)));
    expect(verifySteps(createSteps(score))).toBe(true);
    expect(score.notes.length).toBe(entry.notes);
  }, 15000);
