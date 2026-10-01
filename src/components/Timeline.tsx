import { useEffect, useRef, useState } from "react";
import { handList, noteName, type Step, type Score } from "../core/model";
export function Timeline({
  steps,
  index,
  progress,
  score,
  onSeek,
}: {
  steps: Step[];
  index: number;
  progress: number;
  score: Score;
  onSeek: (i: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState(0);
  const width = 104;
  useEffect(() => {
    if (ref.current) {
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      ref.current.scrollLeft = Math.max(
        0,
        (reduced ? index : progress) * width,
      );
    }
  }, [index, progress]);
  const maxStack = Math.max(
    1,
    ...steps.flatMap((s) => handList.map((h) => s.hands[h].length)),
  );
  const rowHeight = Math.max(115, maxStack * 35 + 24);
  return (
    <div
      className="timeline-shell"
      style={{ "--row-height": `${rowHeight}px` } as React.CSSProperties}
    >
      <div className="lane-labels">
        <span />
        <b className="right-label">
          RH<small>Right</small>
        </b>
        <b className="left-label">
          LH<small>Left</small>
        </b>
      </div>
      <div className="timeline-viewport">
        <div className="play-marker" style={{ left: 2.5 * width }}>
          <span>NOW</span>
        </div>
        <div
          ref={ref}
          className="timeline-scroll"
          onScroll={(e) =>
            setStart(
              Math.max(0, Math.floor(e.currentTarget.scrollLeft / width) - 3),
            )
          }
        >
          <div
            className="timeline-track"
            style={{ width: `calc(100% + ${steps.length * width}px)` }}
          >
            {steps.slice(start, start + 24).map((step, k) => {
              const i = start + k;
              const lookupTick =
                i === steps.length - 1 &&
                handList.every((h) => step.attacks[h].length === 0)
                  ? step.tick - 1
                  : step.tick;
              const measure =
                score.measures.find(
                  (m) => lookupTick >= m.start && lookupTick < m.end,
                ) || score.measures.at(-1);
              return (
                <button
                  type="button"
                  key={i}
                  className={`step ${i === index ? "current" : ""} ${i < index ? "past" : ""}`}
                  style={{ left: (i + 2) * width, width }}
                  onClick={() => onSeek(i)}
                  aria-label={`Step ${i + 1}, section ${measure?.number}`}
                  aria-current={i === index ? "step" : undefined}
                >
                  <span className="step-number">
                    {i + 1}
                    <small>§ {measure?.number}</small>
                  </span>
                  {handList.map((h) => (
                    <span className={`step-hand ${h}`} key={h}>
                      {step.hands[h].map((t, j) => (
                        <span
                          key={j}
                          className={`note-token ${t.action}`}
                          aria-label={`${h} ${t.action} ${t.pitch === undefined ? "" : noteName(t.pitch)}`}
                        >
                          {t.pitch === undefined
                            ? t.action === "hold"
                              ? "—"
                              : "·"
                            : noteName(t.pitch)}
                          {t.action === "add" && (
                            <small aria-hidden="true">●</small>
                          )}
                          {t.action === "release" && (
                            <small aria-hidden="true">○</small>
                          )}
                        </span>
                      ))}
                    </span>
                  ))}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
