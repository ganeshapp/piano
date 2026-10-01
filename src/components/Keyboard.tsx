import { black, noteName, type Hand } from "../core/model";
interface Props {
  pitches: number[];
  held: Record<Hand, number[]>;
  physical: Set<number>;
  wrong: Set<number>;
  follow: boolean;
  onDown: (p: number) => void;
  onUp: (p: number) => void;
}
export function Keyboard({
  pitches,
  held,
  physical,
  wrong,
  follow,
  onDown,
  onUp,
}: Props) {
  let low = Math.max(21, Math.min(...(pitches.length ? pitches : [60])) - 2),
    high = Math.min(108, Math.max(...(pitches.length ? pitches : [72])) + 2);
  while (black(low)) low--;
  while (black(high)) high++;
  const whites = Array.from(
    { length: high - low + 1 },
    (_, i) => low + i,
  ).filter((p) => !black(p));
  const whiteWidth = 100 / whites.length;
  const keys = Array.from({ length: high - low + 1 }, (_, i) => low + i);
  let whiteIndex = -1;
  return (
    <div className="keyboard-scroll">
      <div
        className="keyboard"
        style={{ minWidth: Math.max(600, whites.length * 27) }}
        aria-label="Piano keyboard"
      >
        {keys.map((p) => {
          const isBlack = black(p);
          if (!isBlack) whiteIndex++;
          const rh = held.RH.includes(p),
            lh = held.LH.includes(p),
            isHeld = rh || lh,
            classes = [
              "piano-key",
              isBlack ? "black-key" : "white-key",
              isHeld ? (rh && lh ? "both-key" : rh ? "rh-key" : "lh-key") : "",
              follow ? "expected" : "",
              physical.has(p) ? "physical" : "",
              wrong.has(p) ? "wrong" : "",
            ].join(" ");
          return (
            <button
              key={p}
              className={classes}
              style={{
                left: `${isBlack ? (whiteIndex + 0.68) * whiteWidth : whiteIndex * whiteWidth}%`,
                width: `${whiteWidth * (isBlack ? 0.64 : 1)}%`,
              }}
              aria-label={`${noteName(p)}${rh ? " right hand" : ""}${lh ? " left hand" : ""}${physical.has(p) ? " physically pressed" : ""}`}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                onDown(p);
              }}
              onPointerUp={() => onUp(p)}
              onPointerCancel={() => onUp(p)}
              onKeyDown={(e) => {
                if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                  e.preventDefault();
                  onDown(p);
                }
              }}
              onKeyUp={(e) => {
                if (e.key === " " || e.key === "Enter") onUp(p);
              }}
              onBlur={() => onUp(p)}
            >
              {wrong.has(p) && <b className="wrong-mark">×</b>}
              {physical.has(p) && <i className="physical-dot" />}
              {pitches.includes(p) && (
                <span className="key-label">{noteName(p)}</span>
              )}
              {p === 60 && <span className="middle-label">MIDDLE C</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
