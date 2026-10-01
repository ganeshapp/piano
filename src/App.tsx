import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Headphones,
  HelpCircle,
  KeyboardMusic,
  Layers,
  LoaderCircle,
  Music2,
  Pause,
  Play,
  Plus,
  Repeat2,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  Usb,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { decodeScore, parseScore } from "./core/xml";
import { createSteps, verifySteps } from "./core/notation";
import { Follower, type MidiEvent } from "./core/follow";
import { PianoAudio } from "./core/audio";
import { Transport } from "./core/transport";
import { MidiConnection } from "./core/midi";
import {
  localPieces,
  saveLocal,
  readPrefs,
  savePrefs,
  type LocalPiece,
} from "./core/storage";
import {
  handList,
  noteName,
  secondsAt,
  unique,
  type Difficulty,
  type Entry,
  type Hand,
  type HandFilter,
  type Mode,
  type Score,
} from "./core/model";
import { Timeline } from "./components/Timeline";
import { Keyboard } from "./components/Keyboard";
const EMPTY = { RH: [], LH: [] } as Record<Hand, number[]>;
const formatTime = (n: number) =>
  `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
const safeLink = (s: string) => (/^https?:\/\//i.test(s) ? s : undefined);
interface Prefs {
  mode: Mode;
  hand: HandFilter;
  speed: number;
  interval: number;
  sound: boolean;
  repeat: boolean;
}
const defaultPrefs: Prefs = {
  mode: "listen",
  hand: "both",
  speed: 1,
  interval: 1,
  sound: true,
  repeat: false,
};
export default function App() {
  const [entries, setEntries] = useState<Entry[]>([]),
    [locals, setLocals] = useState<LocalPiece[]>([]),
    [loading, setLoading] = useState(true),
    [loadingPiece, setLoadingPiece] = useState(false),
    [error, setError] = useState("");
  const [query, setQuery] = useState(""),
    [difficulty, setDifficulty] = useState("All"),
    [entry, setEntry] = useState<Entry | null>(null),
    [score, setScore] = useState<Score | null>(null),
    [xml, setXml] = useState("");
  const [prefs, setPrefs] = useState<Prefs>(() => ({
    ...defaultPrefs,
    ...readPrefs("piano-path-settings", {}),
  }));
  const [range, setRange] = useState<[number, number]>([0, 0]),
    [index, setIndex] = useState(0),
    [progress, setProgress] = useState(0),
    [position, setPosition] = useState(0),
    [running, setRunning] = useState(false);
  const [physical, setPhysical] = useState(new Set<number>()),
    [wrong, setWrong] = useState(new Set<number>()),
    [pedal, setPedal] = useState(false),
    [midiRevision, setMidiRevision] = useState(0),
    [modal, setModal] = useState<"help" | "midi" | "mapping" | "info" | null>(
      null,
    ),
    [ack, setAck] = useState(false),
    [followDone, setFollowDone] = useState(false),
    [hearInput, setHearInput] = useState(false),
    [midiOutput, setMidiOutput] = useState(false),
    [metadataEntry, setMetadataEntry] = useState<Entry | null>(null);
  const [mapping, setMapping] = useState<Record<string, Hand | null>>({});
  const audio = useRef(new PianoAudio()).current,
    midi = useRef(new MidiConnection()).current,
    transport = useRef(new Transport(audio)).current,
    follower = useRef<Follower | null>(null),
    inputState = useRef(new Follower([])),
    fileInput = useRef<HTMLInputElement>(null),
    loadSerial = useRef(0),
    playSerial = useRef(0),
    followActive = useRef(false);
  const pendingResume = useRef<number | null>(null),
    auditioning = useRef(new Set<number>());
  const allEntries = useMemo(
    () => [...locals.map((l) => l.entry), ...entries],
    [locals, entries],
  );
  const bounds = useMemo(
    () =>
      score
        ? [
            score.measures[range[0]]?.start || 0,
            score.measures[range[1]]?.end || score.end,
          ]
        : [0, 0],
    [score, range],
  );
  const steps = useMemo(
    () => (score ? createSteps(score, prefs.hand, bounds[0], bounds[1]) : []),
    [score, prefs.hand, bounds],
  );
  const duration = score
    ? secondsAt(bounds[1], score) - secondsAt(bounds[0], score)
    : 0;
  const visiblePitches = useMemo(
    () =>
      score
        ? unique(
            score.notes
              .filter(
                (n) =>
                  (prefs.hand === "both" || n.hand === prefs.hand) &&
                  n.start < bounds[1] &&
                  n.end > bounds[0],
              )
              .map((n) => n.pitch),
          )
        : [],
    [score, prefs.hand, bounds],
  );
  const changePref = <K extends keyof Prefs>(k: K, v: Prefs[K]) =>
    setPrefs((p) => ({ ...p, [k]: v }));
  const halt = useCallback(() => {
    playSerial.current++;
    followActive.current = false;
    auditioning.current.clear();
    transport.pause();
    audio.stop();
    midi.panic();
    setRunning(false);
  }, [transport, audio, midi]);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}catalog.json`)
      .then((r) => {
        if (!r.ok) throw Error("The music library could not be loaded.");
        return r.json();
      })
      .then(setEntries)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    localPieces()
      .then(setLocals)
      .catch(() =>
        setError(
          "Browser storage is unavailable. Built-in pieces still work, but imports may not persist.",
        ),
      );
  }, []);
  useEffect(() => {
    savePrefs("piano-path-settings", prefs);
  }, [prefs]);
  const openPiece = useCallback(
    async (e: Entry) => {
      const serial = ++loadSerial.current;
      halt();
      setLoadingPiece(true);
      setError("");
      setEntry(e);
      setScore(null);
      setAck(false);
      setFollowDone(false);
      try {
        let source = locals.find((l) => l.entry.id === e.id)?.xml;
        if (!source) {
          const r = await fetch(
            `${import.meta.env.BASE_URL}${e.file.split("/").map(encodeURIComponent).join("/")}`,
          );
          if (!r.ok) throw Error("The score file could not be loaded.");
          source = decodeScore(new Uint8Array(await r.arrayBuffer()));
        }
        const savedMapping = readPrefs<Record<string, Hand | null> | undefined>(
          `mapping-${e.id}`,
          undefined,
        );
        const parsed = parseScore(source, {
          title: e.title,
          mapping: savedMapping,
        });
        verifySteps(createSteps(parsed));
        if (serial !== loadSerial.current) return;
        pendingResume.current = readPrefs<number | null>(
          `position-${e.id}`,
          null,
        );
        setXml(source);
        setScore(parsed);
        setMapping(
          Object.fromEntries(parsed.staffs.map((s) => [s.key, s.hand])),
        );
        const savedRange = readPrefs<[number, number]>(`range-${e.id}`, [
          0,
          parsed.measures.length - 1,
        ]);
        setRange([
          Math.min(savedRange[0], parsed.measures.length - 1),
          Math.min(
            Math.max(savedRange[0], savedRange[1]),
            parsed.measures.length - 1,
          ),
        ]);
        savePrefs("last-piece", e.id);
      } catch (err) {
        if (serial === loadSerial.current)
          setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (serial === loadSerial.current) setLoadingPiece(false);
      }
    },
    [halt, locals],
  );
  useEffect(() => {
    const route = () => {
      const id = decodeURIComponent(location.hash.replace(/^#\/piece\//, ""));
      if (location.hash.startsWith("#/piece/") && allEntries.length) {
        const found = allEntries.find((e) => e.id === id);
        if (found) void openPiece(found);
        else if (!loading)
          setError("This piece is not in this browser’s library.");
      } else {
        loadSerial.current++;
        halt();
        setEntry(null);
        setScore(null);
        setLoadingPiece(false);
      }
    };
    window.addEventListener("hashchange", route);
    route();
    return () => window.removeEventListener("hashchange", route);
  }, [allEntries, loading, openPiece, halt]);
  useEffect(() => {
    halt();
    transport.configure(
      steps,
      prefs.mode === "steady",
      prefs.interval,
      duration,
    );
    transport.speed = prefs.mode === "steady" ? 1 : prefs.speed;
    transport.loop = prefs.repeat;
    setIndex(0);
    setProgress(0);
    setPosition(0);
    setFollowDone(false);
    follower.current = new Follower(steps);
    if (score && steps.length && pendingResume.current !== null) {
      const resume = Math.max(
        0,
        Math.min(steps.length - 1, pendingResume.current),
      );
      pendingResume.current = null;
      if (resume > 0) transport.seek(resume);
      setIndex(resume);
      setProgress(resume);
      follower.current = new Follower(steps, resume);
    } else if (entry && score && steps.length) {
      savePrefs(`position-${entry.id}`, 0);
    }
    return () => transport.stop();
  }, [
    steps,
    prefs.mode,
    prefs.interval,
    prefs.speed,
    prefs.repeat,
    duration,
    entry,
    range,
    halt,
    transport,
  ]);
  useEffect(() => {
    if (entry && score && !loadingPiece) savePrefs(`range-${entry.id}`, range);
  }, [entry, score, range, loadingPiece]);
  useEffect(() => {
    audio.enabled = prefs.sound;
    transport.sink = {
      on: (p, t) => {
        if (!prefs.sound) return;
        if (midiOutput && midi.output) midi.send([0x90, p, 72], t - audio.now);
        else audio.on(p, t);
      },
      off: (p, t) => {
        if (midiOutput && midi.output) midi.send([0x80, p, 0], t - audio.now);
        else audio.off(p, t);
      },
      stop: () => {
        audio.stop();
        midi.panic();
      },
    };
  }, [prefs.sound, midiOutput, midiRevision, audio, midi, transport]);
  useEffect(() => {
    transport.onFrame = (i, pos, playing) => {
      setIndex(i);
      setPosition(pos);
      setRunning(playing);
      if (playing && entry && i >= 0) savePrefs(`position-${entry.id}`, i);
      const a = transport.times[Math.max(0, i)] || 0,
        b = transport.times[i + 1];
      setProgress(
        i < 0
          ? 0
          : Math.max(0, i) +
              (playing && b !== undefined
                ? Math.max(0, Math.min(1, (pos - a) / (b - a)))
                : 0),
      );
    };
  }, [transport, entry]);
  useEffect(() => {
    midi.onChange = () => setMidiRevision((n) => n + 1);
    midi.onDisconnect = () => {
      halt();
      inputState.current.resetInput();
      setPhysical(new Set());
      setWrong(new Set());
      setPedal(false);
    };
    return () => {
      midi.dispose();
      transport.stop();
      audio.stop();
    };
  }, [midi, halt, transport, audio]);
  useEffect(() => {
    midi.onEvent = (event: MidiEvent) => {
      inputState.current.input(event);
      setPhysical(new Set(inputState.current.pressed));
      setPedal(inputState.current.pedal);
      if (hearInput && event.type === "on") audio.on(event.pitch);
      if (hearInput && event.type === "off") audio.off(event.pitch);
      if (!followActive.current || !follower.current) return;
      const f = follower.current;
      f.input(event);
      if (entry)
        savePrefs(`position-${entry.id}`, Math.min(f.index, steps.length - 1));
      setWrong(new Set(f.wrong));
      if (f.done) {
        followActive.current = false;
        setRunning(false);
        setFollowDone(true);
        setIndex(steps.length - 1);
        setProgress(steps.length - 1);
        if (prefs.repeat) {
          follower.current = new Follower(steps);
          followActive.current = true;
          setFollowDone(false);
          setRunning(true);
          setIndex(follower.current.index);
          setProgress(follower.current.index);
        }
      } else {
        setIndex(f.index);
        setProgress(f.index);
      }
    };
  }, [midi, hearInput, audio, steps, prefs.repeat, entry]);
  useEffect(() => {
    const blur = () => {
      if (document.hidden) halt();
    };
    document.addEventListener("visibilitychange", blur);
    return () => document.removeEventListener("visibilitychange", blur);
  }, [halt]);
  const seek = useCallback(
    (i: number) => {
      halt();
      const next = Math.max(0, Math.min(steps.length - 1, i));
      transport.seek(next);
      if (entry) savePrefs(`position-${entry.id}`, next);
      setIndex(next);
      setProgress(next);
      setFollowDone(false);
      follower.current = new Follower(steps, next);
      setWrong(new Set());
    },
    [halt, steps, transport, entry],
  );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        !score ||
        modal ||
        /INPUT|SELECT|TEXTAREA|BUTTON/.test((e.target as HTMLElement).tagName)
      )
        return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        seek(index + 1);
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        seek(index - 1);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [score, modal, index, seek]);
  useEffect(() => {
    if (!modal) return;
    const old = document.activeElement as HTMLElement;
    const dialog = document.querySelector<HTMLDialogElement>("dialog");
    dialog?.showModal();
    const close = () => setModal(null);
    dialog?.addEventListener("cancel", close);
    return () => {
      dialog?.removeEventListener("cancel", close);
      dialog?.close();
      old?.focus();
    };
  }, [modal]);
  async function play() {
    setError("");
    if (running) {
      halt();
      return;
    }
    if (score?.warnings.length && !ack) {
      setError(
        "Read the score notes and enable the supported-note preview before starting.",
      );
      return;
    }
    if (!steps.length) return;
    const serial = ++playSerial.current;
    try {
      if (prefs.mode === "follow") {
        if (!midi.input) {
          setModal("midi");
          return;
        }
        if (hearInput) await audio.init();
        if (serial !== playSerial.current) return;
        let f = new Follower(steps, followDone ? 0 : Math.max(0, index));
        if (f.done) f = new Follower(steps);
        follower.current = f;
        setIndex(f.index);
        setProgress(f.index);
        setWrong(new Set());
        setFollowDone(false);
        followActive.current = true;
        setRunning(true);
      } else {
        if (transport.running) return;
        await audio.init();
        if (serial !== playSerial.current) return;
        await transport.play();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function connect() {
    try {
      await midi.connect();
    } catch (e) {
      midi.message = e instanceof Error ? e.message : String(e);
    }
    setMidiRevision((n) => n + 1);
  }
  async function importFile(file: File) {
    setError("");
    try {
      const source = decodeScore(new Uint8Array(await file.arrayBuffer()));
      const parsed = parseScore(source, { title: file.name });
      verifySteps(createSteps(parsed));
      const id = `local-${crypto.randomUUID()}`;
      const item: Entry = {
        id,
        title: parsed.title,
        composer: parsed.composer,
        file: "",
        difficulty: "Unrated",
        basis: "Locally imported arrangement; no verified difficulty label.",
        status: parsed.warnings.length ? "review" : "ready",
        warnings: parsed.warnings,
        source: parsed.source,
        rights: parsed.rights,
        measures: parsed.measures.length,
        notes: parsed.notes.length,
        seconds: secondsAt(parsed.end, parsed),
        local: true,
      };
      const piece = { entry: item, xml: source };
      await saveLocal(piece);
      setLocals((p) => [...p, piece]);
      location.hash = `/piece/${id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    if (fileInput.current) fileInput.current.value = "";
  }
  const held =
    score && steps.length && index >= 0
      ? (prefs.mode === "follow" && !followDone
          ? steps[Math.min(index, steps.length - 1)]?.after
          : steps[Math.min(index, steps.length - 1)]?.after) || EMPTY
      : EMPTY;
  const filtered = allEntries.filter(
    (e) =>
      (difficulty === "All" || e.difficulty === difficulty) &&
      `${e.title} ${e.composer}`.toLowerCase().includes(query.toLowerCase()),
  );
  const readyCount = allEntries.filter((e) => e.status === "ready").length;
  const lastId = readPrefs<string>("last-piece", "");
  const lastPiece = allEntries.find((e) => e.id === lastId);
  const startNotes = score
    ? score.notes.filter(
        (n) =>
          n.start < bounds[0] &&
          n.end > bounds[0] &&
          (prefs.hand === "both" || n.hand === prefs.hand),
      )
    : [];
  return (
    <div className="app">
      <input
        ref={fileInput}
        type="file"
        accept=".xml,.musicxml,.mxl"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importFile(f);
        }}
      />
      <header className="app-header">
        <a className="brand" href="#/" aria-label="Piano Path home">
          <span className="brand-symbol">
            <KeyboardMusic size={23} />
          </span>
          <span>
            Piano<span className="brand-light">Path</span>
          </span>
        </a>
        <span className="header-note">
          A LITTLE PRACTICE. A LITTLE PROGRESS.
        </span>
        <div className="header-actions">
          <button
            className={`connection ${midi.input ? "connected" : ""}`}
            onClick={() => setModal("midi")}
          >
            <span className="status-dot" />
            {midi.input ? "Piano connected" : "Connect your piano"}
            <Usb size={15} />
          </button>
          <button
            className="icon-button"
            aria-label="Notation guide"
            onClick={() => setModal("help")}
          >
            <HelpCircle size={20} />
          </button>
        </div>
      </header>
      {error && (
        <div role="alert" className="error-banner">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {!entry ? (
        <div className="library-layout">
          <aside className="sidebar">
            <div className="sidebar-title">YOUR SPACE</div>
            <div className="nav-active">
              <BookOpen size={18} /> Music library
            </div>
            <div className="sidebar-title difficulty-heading">
              FIND YOUR PACE
            </div>
            <nav aria-label="Difficulty filters">
              {["All", "Beginner", "Intermediate", "Advanced", "Unrated"].map(
                (d) => (
                  <button
                    key={d}
                    className={`difficulty-nav ${difficulty === d ? "selected" : ""}`}
                    onClick={() => setDifficulty(d)}
                  >
                    <span>{d === "All" ? "All pieces" : d}</span>
                    <small>
                      {d === "All"
                        ? allEntries.length
                        : allEntries.filter((e) => e.difficulty === d).length}
                    </small>
                  </button>
                ),
              )}
            </nav>
            <div className="sidebar-note">
              <KeyboardMusic size={27} />
              <h3>Your piano. Your pace.</h3>
              <p>Connect your digital piano and let the music wait for you.</p>
              <button onClick={() => setModal("midi")}>
                Set up MIDI <ArrowRight size={15} />
              </button>
            </div>
            <button className="sidebar-guide" onClick={() => setModal("help")}>
              <HelpCircle size={17} /> How to read the notes
            </button>
          </aside>
          <main className="library-main">
            <div className="library-heading">
              <div>
                <div className="eyebrow">THE PRACTICE ROOM</div>
                <h1>Your next piece.</h1>
                <p>Find something you love. Take it one note at a time.</p>
              </div>
              <button
                className="button dark"
                onClick={() => fileInput.current?.click()}
              >
                <Plus size={18} /> Import MusicXML
              </button>
            </div>
            {lastPiece && (
              <a className="resume-strip" href={`#/piece/${lastPiece.id}`}>
                <span className="resume-icon">
                  <Play size={17} />
                </span>
                <span>
                  <small>PICK UP WHERE YOU LEFT OFF</small>
                  <b>{lastPiece.title}</b>
                </span>
                <ArrowRight size={20} />
              </a>
            )}
            <div className="library-toolbar">
              <div className="search-field">
                <Search size={19} />
                <input
                  aria-label="Search music"
                  placeholder="Search a piece or composer…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button
                    aria-label="Clear search"
                    onClick={() => setQuery("")}
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
              <span className="library-total">
                {filtered.length} pieces <span>·</span> {readyCount} ready
              </span>
            </div>
            <div className="section-heading">
              <h2>
                {difficulty === "All"
                  ? "Explore the library"
                  : `${difficulty} pieces`}
              </h2>
              <span>Solo piano · Built in, ready to explore</span>
            </div>
            {loading ? (
              <div className="empty-state">
                <LoaderCircle className="spin" />
                Opening your music library…
              </div>
            ) : !filtered.length ? (
              <div className="empty-state">
                <Search />
                <h3>No pieces here yet</h3>
                <p>
                  {difficulty === "Intermediate"
                    ? "No verified intermediate arrangements yet. Try All or Unrated."
                    : "Try another title or difficulty filter."}
                </p>
                <button
                  className="button"
                  onClick={() => {
                    setQuery("");
                    setDifficulty("All");
                  }}
                >
                  Show all pieces
                </button>
              </div>
            ) : (
              <div className="piece-grid">
                {filtered.map((e, i) => (
                  <article key={e.id} className="piece-card">
                    <div className="card-top">
                      <span
                        className={`difficulty-badge ${e.difficulty.toLowerCase()}`}
                      >
                        {e.difficulty}
                      </span>
                      <button
                        className="metadata-button"
                        aria-label={`About ${e.title}`}
                        onClick={() => {
                          setMetadataEntry(e);
                          setModal("info");
                        }}
                      >
                        {e.basis.startsWith("Estimated")
                          ? "Estimated"
                          : "Details"}{" "}
                        <HelpCircle size={12} />
                      </button>
                    </div>
                    <a className="piece-main-link" href={`#/piece/${e.id}`}>
                      <div
                        className={`piece-art art-${i % 4}`}
                        aria-hidden="true"
                      >
                        <span />
                        <span />
                        <span />
                        <Music2 size={28} />
                      </div>
                      <h3>{e.title}</h3>
                      <p>{e.composer || "Piano arrangement"}</p>
                      <small className="arrangement-label">
                        {e.arrangement}
                      </small>
                    </a>
                    <div className="card-bottom">
                      <span>
                        {e.status === "ready" ? (
                          <>
                            <span className="ready-dot" /> {e.measures} sections
                            · {formatTime(e.seconds)}
                          </>
                        ) : e.status === "review" ? (
                          <>
                            <span className="review-dot" /> Preview · needs
                            review
                          </>
                        ) : (
                          <>Import issue</>
                        )}
                      </span>
                      <a
                        className="card-play"
                        aria-label={`Open ${e.title}`}
                        href={`#/piece/${e.id}`}
                      >
                        <ArrowRight size={17} />
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <footer className="library-footer">
              Made for your own little moments of music.
              <a
                href={`${import.meta.env.BASE_URL}attribution/notices.txt`}
                target="_blank"
                rel="noreferrer"
              >
                MuseTrainer library · Attribution
              </a>
            </footer>
          </main>
        </div>
      ) : (
        <main className="practice-main">
          <div className="practice-heading">
            <a className="back-link" href="#/">
              <ArrowLeft size={17} /> Library
            </a>
            <div>
              <div className="eyebrow">YOUR PRACTICE SESSION</div>
              <h1>{entry.title}</h1>
              <p>
                {entry.composer || "Solo piano"} <span>·</span>{" "}
                {score?.measures.length || entry.measures} sections
              </p>
            </div>
            <button
              className="button quiet"
              onClick={() => {
                setMetadataEntry(entry);
                setModal("info");
              }}
            >
              Piece details <HelpCircle size={16} />
            </button>
          </div>
          {loadingPiece ? (
            <div className="empty-state">
              <LoaderCircle className="spin" />
              Preparing the notes and keyboard…
            </div>
          ) : score ? (
            <>
              {score.warnings.length > 0 && (
                <details className="review-box" open={!ack}>
                  <summary>
                    Score notes · {score.warnings.length} item
                    {score.warnings.length === 1 ? "" : "s"} to review
                  </summary>
                  <ul>
                    {score.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                  <div className="review-actions">
                    <label>
                      <input
                        type="checkbox"
                        checked={ack}
                        onChange={(e) => {
                          halt();
                          setAck(e.target.checked);
                        }}
                      />{" "}
                      Use this supported-note preview (not a verified complete
                      performance)
                    </label>
                    <button onClick={() => setModal("mapping")}>
                      Hand assignments
                    </button>
                  </div>
                </details>
              )}
              <section
                className="practice-controls"
                aria-label="Practice controls"
              >
                <div className="mode-switch">
                  {(
                    [
                      { id: "listen", label: "Listen", Icon: Headphones },
                      { id: "steady", label: "Steady steps", Icon: Layers },
                      { id: "follow", label: "Follow me", Icon: Usb },
                    ] as const
                  ).map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      className={prefs.mode === id ? "active" : ""}
                      aria-pressed={prefs.mode === id}
                      onClick={() => changePref("mode", id)}
                    >
                      <Icon size={16} />
                      {label}
                    </button>
                  ))}
                </div>
                <div className="control-divider" />
                <label className="control-label">
                  Practice
                  <select
                    value={prefs.hand}
                    onChange={(e) =>
                      changePref("hand", e.target.value as HandFilter)
                    }
                  >
                    <option value="both">Both hands</option>
                    <option value="RH">Right hand</option>
                    <option value="LH">Left hand</option>
                  </select>
                </label>
                <label className="control-label">
                  {prefs.mode === "steady"
                    ? "Seconds / step"
                    : "Playback speed"}
                  <select
                    value={
                      prefs.mode === "steady" ? prefs.interval : prefs.speed
                    }
                    disabled={prefs.mode === "follow"}
                    onChange={(e) =>
                      prefs.mode === "steady"
                        ? changePref("interval", Number(e.target.value))
                        : changePref("speed", Number(e.target.value))
                    }
                  >
                    {(prefs.mode === "steady"
                      ? [0.3, 0.5, 0.75, 1, 1.5, 2, 3]
                      : [0.25, 0.5, 0.75, 1, 1.25, 1.5]
                    ).map((v) => (
                      <option key={v} value={v}>
                        {v}
                        {prefs.mode === "steady" ? " sec" : "×"}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="icon-button"
                  aria-label="Hand assignments"
                  onClick={() => setModal("mapping")}
                >
                  <SlidersHorizontal size={20} />
                </button>
              </section>
              <div className="passage-bar">
                <span>
                  Practice passage{" "}
                  <HelpCircle
                    size={13}
                    aria-label="A section is a numbered measure of the piece."
                  />
                </span>
                <label>
                  From
                  <select
                    aria-label="From section"
                    value={range[0]}
                    onChange={(e) =>
                      setRange([
                        Number(e.target.value),
                        Math.max(Number(e.target.value), range[1]),
                      ])
                    }
                  >
                    {score.measures.map((m) => (
                      <option key={m.index} value={m.index}>
                        {m.number}
                        {score.measures.some(
                          (x) => x.index < m.index && x.number === m.number,
                        )
                          ? " (repeat)"
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  To
                  <select
                    aria-label="To section"
                    value={range[1]}
                    onChange={(e) =>
                      setRange([
                        Math.min(range[0], Number(e.target.value)),
                        Number(e.target.value),
                      ])
                    }
                  >
                    {score.measures.map((m) => (
                      <option key={m.index} value={m.index}>
                        {m.number}
                        {score.measures.some(
                          (x) => x.index < m.index && x.number === m.number,
                        )
                          ? " (repeat)"
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className={`loop-button ${prefs.repeat ? "on" : ""}`}
                  aria-pressed={prefs.repeat}
                  onClick={() => changePref("repeat", !prefs.repeat)}
                >
                  <Repeat2 size={16} /> Loop
                </button>
                <button
                  className="text-button"
                  onClick={() => setRange([0, score.measures.length - 1])}
                >
                  Whole piece
                </button>
                <span className="passage-length">
                  {steps.length} action steps
                </span>
              </div>
              {startNotes.length > 0 && (
                <div className="setup-note">
                  Starting setup:{" "}
                  {handList
                    .map((h) => {
                      const p = unique(
                        startNotes
                          .filter((n) => n.hand === h)
                          .map((n) => n.pitch),
                      );
                      return p.length
                        ? `${h}: ${p.map(noteName).join(" + ")}`
                        : null;
                    })
                    .filter(Boolean)
                    .join(" · ")}
                  . These notes begin before this passage; play them in its
                  first step.
                </div>
              )}
              <section className="notation-panel">
                <div className="notation-heading">
                  <span>
                    <Music2 size={17} /> YOUR NOTES
                  </span>
                  <div className="notation-legend">
                    <span>Normal: replace</span>
                    <span className="add-text">● Add</span>
                    <span className="release-text">○ Release</span>
                    <span>— Hold</span>
                    <span>· Rest</span>
                  </div>
                </div>
                {steps.length ? (
                  <Timeline
                    steps={steps}
                    index={index}
                    progress={progress}
                    score={score}
                    onSeek={seek}
                  />
                ) : (
                  <div className="empty-state">
                    No notes for this hand in the selected passage.
                  </div>
                )}
                <div className="transport-bar">
                  <div className="transport-buttons">
                    <button
                      className="icon-button"
                      aria-label="Restart passage"
                      onClick={() => seek(0)}
                    >
                      <RotateCcw size={19} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Previous step"
                      onClick={() => seek(index - 1)}
                      disabled={!steps.length || index <= 0}
                    >
                      <ChevronLeft size={22} />
                    </button>
                    <button
                      className="play-button"
                      onClick={() => void play()}
                      disabled={
                        !steps.length || (!ack && score.warnings.length > 0)
                      }
                    >
                      {running ? (
                        <Pause size={19} fill="currentColor" />
                      ) : (
                        <Play size={19} fill="currentColor" />
                      )}
                      {running
                        ? "Pause"
                        : prefs.mode === "follow"
                          ? "Start practice"
                          : "Play"}
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Next step"
                      onClick={() => seek(index + 1)}
                      disabled={!steps.length || index >= steps.length - 1}
                    >
                      <ChevronRight size={22} />
                    </button>
                  </div>
                  <div className="transport-status" aria-live="polite">
                    {prefs.mode === "follow"
                      ? followDone
                        ? "Passage complete — nice work."
                        : running
                          ? "Waiting for your next notes…"
                          : "Your piano sets the pace."
                      : `${formatTime(position / (prefs.mode === "steady" ? 1 : prefs.speed))} / ${formatTime(transport.end / (prefs.mode === "steady" ? 1 : prefs.speed))}`}
                    <small>
                      {prefs.mode === "steady"
                        ? "Even spacing · movement practice"
                        : prefs.mode === "follow"
                          ? "Checks new notes, not timing or pedal accuracy"
                          : score.defaultTempo
                            ? "Default tempo: 120 BPM"
                            : "Original rhythm · adjusted by playback speed"}
                    </small>
                  </div>
                  <div className="transport-right">
                    <span>
                      {Math.max(0, index + 1)} / {steps.length}
                    </span>
                    <button
                      className="icon-button"
                      aria-label={
                        prefs.sound
                          ? "Mute demonstration"
                          : "Unmute demonstration"
                      }
                      onClick={() => {
                        halt();
                        changePref("sound", !prefs.sound);
                      }}
                    >
                      {prefs.sound ? (
                        <Volume2 size={20} />
                      ) : (
                        <VolumeX size={20} />
                      )}
                    </button>
                  </div>
                </div>
              </section>
              <section className="keyboard-panel">
                <div className="keyboard-heading">
                  <span>
                    <KeyboardMusic size={19} /> YOUR KEYBOARD
                  </span>
                  <div>
                    <span className="hand-legend right">
                      <i />
                      Right hand
                    </span>
                    <span className="hand-legend left">
                      <i />
                      Left hand
                    </span>
                    <span className="physical-legend">● Your pressed keys</span>
                  </div>
                  <small>
                    {visiblePitches.length
                      ? `${noteName(Math.min(...visiblePitches))} – ${noteName(Math.max(...visiblePitches))}`
                      : ""}
                  </small>
                </div>
                <Keyboard
                  pitches={visiblePitches}
                  held={held}
                  physical={physical}
                  wrong={wrong}
                  follow={prefs.mode === "follow"}
                  onDown={(p) => {
                    auditioning.current.add(p);
                    void audio
                      .init()
                      .then(() => {
                        if (auditioning.current.has(p)) audio.on(p);
                      })
                      .catch((e) => setError(String(e)));
                  }}
                  onUp={(p) => {
                    auditioning.current.delete(p);
                    audio.off(p);
                  }}
                />
                <div className="keyboard-foot">
                  <span>
                    {prefs.mode === "follow"
                      ? "Outlined keys are expected. A dot shows a physical key press."
                      : "Colored keys remain held until their release."}
                  </span>
                  <span>
                    {pedal
                      ? "Sustain pedal down · tracked separately"
                      : "Fixed view for this passage"}
                  </span>
                </div>
              </section>
            </>
          ) : (
            <div className="empty-state">
              <Music2 />
              <h3>This score needs attention</h3>
              <p>{error || entry.warnings.join(" ")}</p>
              <button
                className="button"
                onClick={() => fileInput.current?.click()}
              >
                Import a different MusicXML
              </button>
            </div>
          )}
        </main>
      )}
      {modal && (
        <dialog
          className="modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <div className="modal-inner">
            <button
              className="modal-close icon-button"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              <X size={21} />
            </button>
            {modal === "help" && (
              <>
                <div className="eyebrow">A SIMPLER WAY TO READ</div>
                <h2>One step at a time.</h2>
                <p>
                  Read right hand (RH) above left hand (LH). Notes in the same
                  column happen together. Stacked names mean press those keys
                  together.
                </p>
                <div className="guide-grid">
                  <b>C4</b>
                  <span>Release this hand’s previous keys, then press C4.</span>
                  <b className="add-text">E4 ●</b>
                  <span>
                    Add E4, keeping the other keys down. If E4 is already held,
                    release and press it again.
                  </span>
                  <b className="release-text">E4 ○</b>
                  <span>Release only E4. Keep the other keys held.</span>
                  <b>—</b>
                  <span>No change. Keep holding or remain silent.</span>
                  <b>·</b>
                  <span>Release every key in this hand.</span>
                </div>
                <p>
                  <strong>C4 is middle C.</strong> A sharp, like F#4, identifies
                  the black key above F4. Labels always use this app’s octave
                  numbering.
                </p>
                <h3>Choose your pace</h3>
                <p>
                  <strong>Listen</strong> follows the music’s rhythm.{" "}
                  <strong>Steady steps</strong> gives every action equal
                  practice time. <strong>Follow me</strong> waits for new
                  presses from your connected piano; it does not grade timing or
                  strict releases.
                </p>
                <p className="muted">
                  Use the arrow buttons or your laptop’s left/right arrows to
                  inspect individual steps. Click a key to audition it. The
                  on-screen keyboard does not replace MIDI input for Follow me.
                </p>
              </>
            )}
            {modal === "midi" && (
              <>
                <div className="eyebrow">PLAY TOGETHER</div>
                <h2>Connect your piano.</h2>
                <p>
                  Connect your digital piano’s USB/MIDI cable to this laptop,
                  then allow MIDI access. This reads key presses directly, not
                  through a microphone.
                </p>
                <div className="midi-status">
                  <Usb size={25} />
                  <span>{midi.message}</span>
                </div>
                <button className="button dark" onClick={() => void connect()}>
                  <Usb size={17} />
                  {midi.access ? "Refresh connection" : "Connect piano"}
                </button>
                {midi.inputs.length > 0 && (
                  <label className="field-label">
                    MIDI input
                    <select
                      value={midi.input}
                      onChange={(e) => {
                        midi.input = e.target.value;
                        halt();
                        inputState.current.resetInput();
                        setPhysical(new Set());
                        midi.bind();
                      }}
                    >
                      {midi.inputs.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name || p.id}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={hearInput}
                    onChange={(e) => {
                      halt();
                      setHearInput(e.target.checked);
                      if (e.target.checked) void audio.init();
                    }}
                  />{" "}
                  Hear my input through the browser
                </label>
                <p className="muted">
                  Leave this off if your piano already makes sound, to avoid
                  hearing it twice.
                </p>
                <details>
                  <summary>Optional MIDI playback output</summary>
                  <label className="field-label">
                    Output device
                    <select
                      value={midi.output}
                      onChange={(e) => {
                        halt();
                        midi.output = e.target.value;
                        setMidiRevision((n) => n + 1);
                        if (!e.target.value) setMidiOutput(false);
                      }}
                    >
                      <option value="">None — use browser sound</option>
                      {midi.outputs.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name || p.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      disabled={!midi.output}
                      checked={midiOutput}
                      onChange={(e) => {
                        halt();
                        setMidiOutput(e.target.checked);
                      }}
                    />{" "}
                    Play demonstrations through this piano
                  </label>
                  <p className="muted">
                    Demonstration output is disabled in Follow me. Browser input
                    monitoring is never sent back to MIDI.
                  </p>
                </details>
                <p className="muted">
                  Chrome or Edge on a laptop is recommended for MIDI. If your
                  browser has no MIDI support, Listen, Steady steps, and manual
                  navigation still work.
                </p>
              </>
            )}
            {modal === "mapping" && score && (
              <>
                <div className="eyebrow">ADVANCED · ARRANGEMENT SETUP</div>
                <h2>Hand assignments.</h2>
                <p>
                  Ordinary piano scores use an upper and lower written staff.
                  Extra staves may be another instrument or an alternative
                  passage. These settings are saved for this arrangement.
                </p>
                {score.staffs.map((s) => (
                  <label className="mapping-row" key={s.key}>
                    {s.name}
                    <select
                      value={mapping[s.key] || "ignore"}
                      onChange={(e) =>
                        setMapping((p) => ({
                          ...p,
                          [s.key]:
                            e.target.value === "ignore"
                              ? null
                              : (e.target.value as Hand),
                        }))
                      }
                    >
                      <option value="RH">Right hand</option>
                      <option value="LH">Left hand</option>
                      <option value="ignore">Exclude</option>
                    </select>
                  </label>
                ))}
                <button
                  className="button dark"
                  onClick={() => {
                    try {
                      halt();
                      const parsed = parseScore(xml, {
                        mapping,
                        title: entry?.title,
                      });
                      verifySteps(createSteps(parsed));
                      savePrefs(`mapping-${entry!.id}`, mapping);
                      setScore(parsed);
                      setAck(false);
                      setRange([0, parsed.measures.length - 1]);
                      setModal(null);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  Apply assignments <Check size={17} />
                </button>
                <p className="muted">
                  This does not automatically identify crossed hands. If you are
                  unsure, choose a ready arrangement instead of guessing.
                </p>
              </>
            )}
            {modal === "info" && metadataEntry && (
              <>
                <div className="eyebrow">ABOUT THIS ARRANGEMENT</div>
                <h2>{metadataEntry.title}</h2>
                <p>
                  {metadataEntry.composer ||
                    "Composer not specified in the file"}
                </p>
                <span
                  className={`difficulty-badge ${metadataEntry.difficulty.toLowerCase()}`}
                >
                  {metadataEntry.difficulty}
                </span>
                <p>{metadataEntry.basis}</p>
                {safeLink(
                  metadataEntry.difficultySource || metadataEntry.source,
                ) && (
                  <a
                    className="source-link"
                    href={safeLink(
                      metadataEntry.difficultySource || metadataEntry.source,
                    )}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open arrangement source ↗
                  </a>
                )}
                <h3>Score information</h3>
                <p>{metadataEntry.arrangement}</p>
                <p>
                  {metadataEntry.measures} sections · {metadataEntry.notes}{" "}
                  notes · approximately {formatTime(metadataEntry.seconds)} at
                  file/default tempo.
                </p>
                {metadataEntry.warnings.length > 0 && (
                  <ul>
                    {metadataEntry.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
                <h3>Attribution</h3>
                <p>
                  {metadataEntry.rights.length
                    ? metadataEntry.rights.join(" · ")
                    : "No individual rights statement is embedded in this file. The source library describes its collection as public domain; retain and review the source information before public redistribution."}
                </p>
                <p className="muted">
                  Imports and progress stay in this browser. Clearing browser
                  storage removes them. Piano sound is synthesized locally; no
                  remote sample service is used.
                </p>
              </>
            )}
          </div>
        </dialog>
      )}
    </div>
  );
}
