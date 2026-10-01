import type { Entry } from "./model";
export interface LocalPiece {
  entry: Entry;
  xml: string;
}
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("piano-path", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("pieces", { keyPath: "entry.id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function localPieces(): Promise<LocalPiece[]> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction("pieces"),
      r = t.objectStore("pieces").getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    t.oncomplete = () => d.close();
  });
}
export async function saveLocal(piece: LocalPiece) {
  const d = await db();
  return new Promise<void>((resolve, reject) => {
    const t = d.transaction("pieces", "readwrite");
    t.objectStore("pieces").put(piece);
    t.oncomplete = () => {
      d.close();
      resolve();
    };
    t.onerror = () => reject(t.error);
  });
}
export function readPrefs<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
export function savePrefs(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage may be disabled. Session remains usable. */
  }
}
