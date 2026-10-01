# Implementation report

## Delivered

Piano Path is a working browser-only practice application prepared for GitHub Pages. It includes the two-hand scrolling action notation, stable cropped keyboard, scientific key addresses, local audio, Listen/Steady steps/Follow me, manual navigation, hand filtering, measure-occurrence passages and looping, browser MIDI input and optional output, local MusicXML/MXL import, and persistent library/preferences/progress.

All **69** upstream library files are included and exposed in the catalog. **11** have no detected review flags; **58** expose concrete limitations and require a supported-preview acknowledgement before playback. There are **0** failed catalog imports. “Ready” means format/translation checks passed, not that a pianist verified the source or the hand assignments.

The library has **7 estimated Beginner**, **34 estimated Advanced**, and **28 Unrated** arrangements. No external classification was invented when source pages could not be accessed. Version filenames are visible so different arrangements remain distinguishable. Complete per-file reasons appear in `catalog-inventory.md` and the details dialog.

The source, lockfile, runtime assets, tests, documentation, upstream notices, and `.github/workflows/pages.yml` are prepared for the user-created repository `ganeshapp/piano`. The Actions deployment succeeded; the published library and an actual built-in score were verified at `https://www.gapp.in/piano/`.

## Verification

- **112 automated tests passed** with Vitest, covering XML/MXL import, pitches/enharmonics, ties, tempo changes, exact ordinary tuplet durations, simultaneous chords, independent holds and selective releases, repeated attacks, final release, hand filtering, passage-entry setup, round-trip instruction interpretation, MIDI matching, mock devices, routing, transport cancellation and looping.
- Every one of the 69 bundled arrangements was parsed and its action sequence passed the independent interpreter check. These checks do not establish that unsupported ornaments or source errors are musically correct.
- TypeScript and the Vite production build passed. The production site is approximately 2.1 MB including the scores and notices; no sound sample download is needed.
- Browser checks in the **Codex in-app browser** exercised library filtering, opening an actual built-in score, manual stepping, original/steady playback, loop continuity, pause, hand filtering, position/range persistence, MusicXML and MXL file import, local import persistence after refresh, and readable selective-release instructions with matching held keyboard keys.
- The **actual production output** was served at `http://127.0.0.1:4173/piano-preview/`. Catalog and score loading worked there, as did refreshing a nested `#/piece/...` route and restoring its passage/position. GitHub Actions also completed a clean public-registry install, all 112 tests, the build, and deployment. The public HTTPS site was then verified in the browser.
- A 720-pixel window was checked for a usable stacked layout. The keyboard has horizontal scrolling when its fixed passage range cannot fit. The default desktop view was also inspected.
- No physical MIDI device was connected for verification. Chrome/Edge hardware acceptance and audible latency on the user's particular piano still need a first-use check. Unsupported/declined MIDI, disconnect/reconnect, device switching, input/output separation and output cleanup have automated coverage.
- Browser interaction verified playback state and visual synchronization. This is not an acoustic timing measurement or a claim of expert musical listening review.

## Material design decisions and deviations

1. **Modern browser refactor rather than the legacy Angular runtime.** The legacy MuseTrainer source was inspected, but its initial browser dependency install failed on peer conflicts. Its native wrappers and score-cursor architecture were not carried forward. React/Vite plus an explicit event engine provides the requested behavior; the original MIT notice is retained.
2. **Synthesized local piano-like sound.** No third-party piano soundfont is bundled. This avoids a remote audio-service dependency, but the tone is less realistic than a sampled piano. The real piano can provide its own sound; optional MIDI demonstration output is available.
3. **Honest readiness limits.** The full collection is visible, including complex works. Unsupported advanced notation is labeled before playback rather than silently presented as complete. The user's normal path can start with a ready arrangement.
4. **Difficulty is estimated or Unrated.** Exact source pages inspected during preparation were inaccessible. Estimated labels are visibly distinguished, with the rationale and source retained.
5. **No staff score renderer.** The final direction replaced sheet music with action notation. The user can inspect source links and advanced staff-to-hand assignments, but daily practice does not require reading a score.

## Browser audio compatibility fix

Audio releases feature-detect `AudioParam.cancelAndHoldAtTime`. Browsers without it use standard automation cancellation and a reconstructed release endpoint. Regression tests cover both paths, early and late releases, scheduled reattacks, and cleanup. This addresses the reported Firefox playback failure; the fallback tests simulate the missing method rather than claiming an automated Firefox browser run.

## Current musical limits

Supported input is partwise MusicXML and valid manifest-based MXL. Timewise MusicXML is rejected. Files/expanded archives over 24 MB and unsupported fractional timing are rejected with messages.

Grace notes are omitted; ornaments/trills/tremolos/glissandos are not expanded; rolled chords are simultaneous. These are flagged. Pedal markings are flagged and not performed; written key duration remains the action duration. Fermatas use written length without an extra expressive hold. Written octave-shift lines and transposing instruments are flagged; the preview uses encoded written pitch. Navigation jumps such as D.C./D.S./coda and nested/unusual repeats are flagged. Simple repeat sections and first/second endings are supported, with a bounded traversal.

Ordinary two-staff piano maps the upper staff to RH and lower to LH. Multiple parts, extra/alternative staves, single-staff input, and detected voices moving between staves are flagged. Other parts are not automatically combined into two hands. An advanced mapping dialog permits explicit overrides and exclusions, saved per arrangement. No inference can guarantee crossed-hand fingering; flags remain important.

Overlapping voices on the same physical key use a combined hold with explicit reattacks and a review flag. Out-of-range notes and microtones are omitted with a warning. Unmatched/unfinished ties are flagged.

Dynamics, expressive tempo shaping not encoded as numeric tempo, staccato/legato interpretation, fingering, and humanized performance are not reproduced. The sound uses fixed demonstration velocity and score durations. This is a key-action study aid, not an engraving engine or professional performance simulator. Follow me checks fresh pitches, not detailed duration, pedaling, articulation, fingering or timing accuracy.

## Concrete provenance issue retained for later publication

The library checkout has no standalone LICENSE file; its README describes it as a public-domain collection. **60 of 69** arrangements contain no embedded rights statement. Every affected filename and source link is listed in `THIRD_PARTY_NOTICES.md`, while individual statements from the other nine are retained in catalog metadata and original scores. The application's MIT notice is not asserted to cover these arrangements. Personal local use can proceed; the inventory makes any later public-release review concrete rather than hiding missing metadata.

## First physical-piano check

Connect the piano in desktop Chrome/Edge, choose the correct input, and use the provided held-note study. Confirm ordinary notes, a staggered chord, a wrong note then correction, release/re-press of a repeated pitch, and reconnecting the USB cable. Leave browser input monitoring off if the piano already sounds. No code changes or account setup should be needed to start this check.
