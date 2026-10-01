# Piano Path

A personal solo-piano practice studio. Read two scrolling rows of key addresses instead of sheet music, see the keys on a large piano, and practice with your connected digital piano.

This is a working static web application. No server accounts, analytics, paid service, remote soundfonts, or API keys are required. All 69 MusicXML arrangements from the pinned MuseTrainer library are included. The app is deployed at **https://www.gapp.in/piano/**.

## Run locally

Use Node.js 22 and npm.

```sh
npm ci
npm run dev
```

Open the local address printed by the server (normally `http://127.0.0.1:5173`). Keep that terminal running. Do not open `index.html` directly as a file.

```sh
npm test            # musical, MIDI, transport, and whole-catalog checks
npm run build      # TypeScript + production bundle in dist/
npm run preview    # serve the production bundle locally
npm run preview:pages  # verify /piano-preview/ project-path hosting
npm run catalog    # regenerate catalog and inclusion report from public/scores
npm run check      # tests followed by production build
npm run format     # format application source, tests and scripts
```

If npm reports a cache permission problem on this machine, use `npm ci --cache ./work/npm-cache`.

## Start practicing

1. Choose a piece from the library. Search its name or composer, or filter by difficulty.
2. Start with a **ready** piece. A **Preview · needs review** score lists features this version cannot reproduce fully. Read those notes before enabling its supported-note preview.
3. Choose **Both hands**, **Right hand**, or **Left hand**, and a passage using **From / To**. A section is a numbered measure in the music. Repeated sections have distinct playback occurrences.
4. Use **Listen** to hear the original written rhythm, **Steady steps** to space all actions equally, or **Follow me** to wait for your actual piano presses.
5. Use previous/next, click a notation column, or use laptop left/right arrows to inspect steps. **Loop** repeats the selected passage. **Restart** returns to its first step.
6. Return to the library when done. Preferences, last piece, passage, and position are stored in this browser.

**C4 is middle C.** The supported keyboard is A0–C8. Black keys use sharp names (for example, F#4). Source flats are converted to the same physical key address.

### Read the notation

| Display | Action in that hand |
| --- | --- |
| Normal note names | Release the old keys, then press all names in this cell together. |
| Red names with a small filled dot below | Add these keys while holding the others. If a named key is already held, release and press it again. |
| Blue names with a small hollow circle below | Release only those keys. |
| Dash | No change: continue holding or remain silent. |
| Standalone dot | Release all keys in this hand. |

RH is the top row; LH is the bottom row. Both rows in a column act together. A blue release and red addition can share a cell. An action step is **not a beat**. Release-only steps are included.

Keyboard purple means right hand; green means left hand. Those colors have a different role from red/blue action instructions. The key range stays fixed throughout the selected passage. Keys used in the passage carry addresses; middle C is marked when visible.

### Connect your digital piano

Connect its USB/MIDI interface to the laptop. In the app, choose **Connect your piano**, then **Connect piano**, and allow the browser's MIDI request. Pick the intended input if more than one device is available.

Chrome or Edge on desktop is the intended MIDI environment. Runtime detection reports unsupported browsers or missing devices; the rest of the app remains usable. MIDI reads key events, not microphone audio. The current implementation was browser-tested in the Codex in-app browser; MIDI connection and input behavior were tested with simulated devices/events. Physical hardware was not available for verification.

In **Follow me**, press the highlighted new notes. A chord can be pressed with small delays, but all its new notes must be down together. A wrong key gets an amber outline and ×; release it to correct. A repeated note needs a new press. Earlier notes may be released early or held longer without blocking; this mode does not grade rhythm, pedal, fingering, or strict releases. Release-only steps advance automatically. Pedal status is displayed separately from physically held keys.

If your piano already sounds, leave **Hear my input through the browser** off to avoid doubled sound. Optional demonstration MIDI output is explicitly enabled in connection settings, is off by default, and is not used for Follow me. The app does not echo received input back to a MIDI output. Some hardware may itself loop output back to input; do not enable hardware MIDI-thru loops.

Browser sound is a locally synthesized plucked/decaying piano-like tone, not a sampled concert piano. Listening follows written note durations and tempo changes, not an expressive pianist's performance.

### Import your own music

Choose **Import MusicXML** and a `.musicxml`, `.xml`, or `.mxl` file. Import is local and never uploaded to a server. Partwise MusicXML is supported; compressed MXL archives are read through their manifest. Invalid input produces an error without replacing your library.

Imported scores are stored in IndexedDB. Preferences and progress use localStorage. Clearing site data removes imports and settings. Browser profiles/devices do not share these records. If browser storage is unavailable, built-in pieces remain usable; importing a persistent library may fail with an error.

The sample `tests/fixtures/held-note-study.musicxml` (and its `.mxl` equivalent) demonstrates a held C4 with a moving right-hand line over a left-hand chord. It is a small original exercise, useful for learning the add/release symbols.

## Music library and difficulty

Scores are loaded on demand. The complete inventory is in [docs/catalog-inventory.md](docs/catalog-inventory.md); it accounts for all 69 source files without merging different arrangements based on title.

The initial difficulty labels are **estimated or Unrated**, not verified teacher grades. The exact source pages examined during preparation were inaccessible. Explicit “easy”/“beginner” arrangement titles produce visibly estimated Beginner labels; a conservative density/large-span heuristic produces estimated Advanced labels. Everything else is Unrated. There are currently no source-verified Intermediate entries. The details dialog exposes each basis and source. A slow tempo or simplified notation does not make a difficult arrangement easy to play.

`npm run catalog` regenerates `public/catalog.json` and the report deterministically. To add a built-in score, put it in `public/scores/` and run that command and `npm run check`. Catalog IDs derive from filenames, so keep those filenames stable when preserving saved progress. Arrangement filenames appear under titles to distinguish versions.

See [docs/architecture.md](docs/architecture.md) for the model and [docs/implementation-report.md](docs/implementation-report.md) for supported features, verification, and known limits.

## Publish later on GitHub Pages

The repository can have any name. Vite uses relative asset URLs and hash routes, so a project path such as `https://USER.github.io/REPO/#/piece/ID` works without a custom server rewrite.

1. Use the repository at `https://github.com/ganeshapp/piano`.
2. Push this project to its `main` branch. Include source, `public/`, docs, tests, the lockfile, and `.github/`. Do not add `node_modules`, `dist`, or `work` (already ignored).
3. In repository **Settings → Pages**, set the source to **GitHub Actions**.
4. Run **Test and deploy Piano Path** from the Actions tab, or push another commit to `main`.
5. Wait for the build and deploy jobs to succeed. GitHub provides the published URL in the deployment result.

The workflow checks pull requests without deploying them. The initial Actions deployment succeeded and the live library and a built-in score were verified. Set the Pages source to GitHub Actions so future deployments use the compiled app. The workflow follows [GitHub's custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

A static Pages website is normally publicly reachable. App code licensing and individual musical arrangement rights are separate; retained source metadata and concrete missing notices are described in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). No extra third-party downloads are needed for playback once the site assets load.
