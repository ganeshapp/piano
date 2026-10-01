# Architecture and musical model

## Browser-only adaptation

The original MuseTrainer source was inspected at commit `d394a953448811dff43c820737d86a07c6a3bc5b`. Its Angular/Ionic application and native integrations were not a clean browser-only baseline: the install attempt failed with peer-dependency conflicts. The requirements permit a web-only refactor. This implementation uses React + TypeScript + Vite and reimplements the practice flow around a normalized event model. It is not a claim that the legacy build was successfully reproduced. The original MIT notice is retained.

Library source: `https://github.com/musetrainer/library`, commit `9128876f6164d96997c877a2be843349a32bdabb`. The checked-in score files are the runtime source; no submodule, git clone, or network scraping happens in a user's browser.

## Data flow

```text
MusicXML / MXL
  → decode archive and validate XML
  → parse parts, staves, voices, rational timing and written pitch
  → map staves to hands, expand simple repeat occurrences, merge ties
  → Score: note identities, start/end ticks, tempo map, occurrence measures
  → select hands and passage, synthesize entry/exit state
  → Step[]: before/after key sets, attacks, releases, instruction tokens
     → two-row timeline
     → virtual keyboard expected state
     → original/steady playback transport
     → MIDI Follow me expected new attacks
```

`xml.ts` parses actual pitch/alter/octave values, not the printed accidental alone. `ppq` uses a bounded least common multiple of divisions, multiplied by four, keeping ordinary tuplets exact. Ordinary repeat occurrences get unique note identities and measure indexes. A tied continuation extends the original note instead of triggering another attack. Source pitch spellings are retained internally; UI addresses normalize to sharps and MIDI60=C4.

`notation.ts` groups starts and ends at exact ticks. Per-hand physical state is derived from note identities, so one note ending does not accidentally release a same-pitch note still active in another voice. New attacks remain distinct from held states. Passage entry clips earlier held notes into a synthetic setup attack; passage exit releases everything.

Canonical token rules use replacements when no old keys survive; otherwise selective blue releases plus red additions preserve the surviving keys. A repeated attack under a hold is a red re-press. The independent `interpret()` implementation reconstructs attacks, releases, and held states, and `verifySteps()` compares these with normalized events. This validates translation, not source edition accuracy or inferred hands.

## Timing

Listen uses a piecewise tempo map to convert score ticks into seconds. Steady steps maps index to a configurable interval, explicitly changing the music's rhythm for movement practice. Original timestamps are retained.

Transport schedules audio/MIDI roughly 90 ms ahead and replenishes at 25 ms intervals. AudioContext time is the master clock; animation frames only render the current position. Pause clears pending browser voices and pending MIDI output. Resume restores any sounding state before the next event. A generation counter invalidates a pending async start if the user stops before audio initialization completes.

Timeline rendering is limited to 24 nearby columns. A fixed marker and interpolated scrolling track the transport. Reduced-motion preferences use discrete steps. Keyboard cropping uses the selected passage, not the currently sounding pitches.

## MIDI

`midi.ts` owns a single selected input listener, connection changes, optional output, and panic cleanup. Web MIDI is requested only after user action, without SysEx. Input bytes are normalized by `decodeMidi()`. Velocity-zero note-on is note-off. Keys are tracked by channel and pitch so a release on one channel cannot release another channel's physical key.

`Follower` waits for fresh attacks for the current step, supports staggered chord entry and wrong-key correction, requires release/re-press for repeated notes, and skips release-only steps. This intentionally forgiving checker does not grade accurate note lengths. Sustain input is tracked separately and never adds pitches to the physical key set. App-generated output does not enter the input checker.

## Storage and deployment

Imports: IndexedDB object store `pieces`, keyed by `entry.id`. Preferences/range/mapping/progress: localStorage. The imported XML is retained, so mapping can be changed without another file upload. There is no remote database or authentication.

`public/catalog.json` contains static metadata; score contents load only when opened. Hash routing preserves project subpaths. Vite `base: './'` ensures assets, catalog, and scores remain under the deployed repository path.

## Key files

| File | Responsibility |
| --- | --- |
| `src/App.tsx` | Library, practice session state, UI controls, connections and dialogs |
| `src/core/xml.ts` | Import, staff mapping, notes, ties, tempo and repeat expansion |
| `src/core/notation.ts` | Action generation, passage slicing, independent validation |
| `src/core/transport.ts` | Original and steady scheduling, seek, loop and cancellation |
| `src/core/audio.ts` | Local synthesized sound and voice cleanup |
| `src/core/follow.ts` | MIDI normalization and forgiving practice matching |
| `src/core/midi.ts` | Browser MIDI lifecycle and explicit output |
| `src/core/storage.ts` | Local imports and settings |
| `src/components/Timeline.tsx` | Virtualized two-hand notation |
| `src/components/Keyboard.tsx` | Fixed-range labeled keyboard and physical feedback |
| `scripts/catalog.ts` | Reproducible inventory, readiness and estimated difficulty |

There is no sheet-music renderer, card generator, mobile wrapper, microphone transcription, or MIDI-file importer. These were explicitly outside the final direction.
