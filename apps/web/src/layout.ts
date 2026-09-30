import { useCallback, useEffect, useState } from "react";

/**
 * View layout (panel sizes, expanded state, column widths) kept in localStorage per source + table.
 * Keys: `fsv.layout.v1:<sourceId>:<kind>:<table>`.
 */
const PREFIX = "fsv.layout.v1:";

export type LayoutKind = "panel" | "cols";

export const layoutKey = (sourceId: string, table: string, kind: LayoutKind) => `${PREFIX}${sourceId}:${kind}:${table}`;

const listeners = new Set<() => void>();

function read<T extends object>(key: string): T {
  try {
    const raw = localStorage.getItem(key);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return (v && typeof v === "object" ? v : {}) as T;
  } catch {
    return {} as T;
  }
}

function write(key: string, value: object): void {
  try {
    const json = JSON.stringify(value);
    if (json === "{}") localStorage.removeItem(key);
    else localStorage.setItem(key, json);
  } catch {
    /* storage full or disabled: the layout just is not remembered */
  }
}

/** An object-valued state that is loaded from and saved to localStorage under `key`. */
export function useStoredState<T extends object>(key: string): [T, (update: (prev: T) => T) => void] {
  const [value, setValue] = useState<T>(() => read<T>(key));
  useEffect(() => {
    setValue(read<T>(key));
    const reload = () => setValue(read<T>(key));
    listeners.add(reload);
    return () => {
      listeners.delete(reload);
    };
  }, [key]);
  const update = useCallback(
    (fn: (prev: T) => T) =>
      setValue((prev) => {
        const next = fn(prev);
        if (next !== prev) write(key, next);
        return next;
      }),
    [key],
  );
  return [value, update];
}

/** Forgets every stored panel size, expanded flag and column width of one source. */
export function resetLayout(sourceId: string): void {
  const prefix = `${PREFIX}${sourceId}:`;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(prefix)) doomed.push(k);
    }
    for (const k of doomed) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
  for (const l of listeners) l();
}