export async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  // Resolved against the origin, not the page URL: a page opened as https://user:pass@host/ (Basic auth of the
  // online sample) would otherwise make fetch reject relative URLs that inherit the credentials.
  const res = await fetch(new URL(path, window.location.origin), { signal });
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body;
}

/** How many `limited()` tasks may run at once; the rest wait in FIFO order. */
const MAX_CONCURRENT = 3;
let active = 0;
const waiting: (() => void)[] = [];

const abortError = () => new DOMException("Aborted", "AbortError");

export const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/**
 * Runs `task` once one of the MAX_CONCURRENT slots is free. Aborting `signal` before the task has
 * started drops it from the queue (the promise rejects with an AbortError); a started task runs to the end.
 */
export function limited<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const release = () => {
    const next = waiting.shift();
    if (next) next(); // hand the slot straight to the next waiter
    else active--;
  };
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    if (active < MAX_CONCURRENT) {
      active++;
      return resolve();
    }
    const start = () => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    };
    const cancel = () => {
      const i = waiting.indexOf(start);
      if (i >= 0) waiting.splice(i, 1);
      reject(abortError());
    };
    signal?.addEventListener("abort", cancel, { once: true });
    waiting.push(start);
  }).then(async () => {
    try {
      if (signal?.aborted) throw abortError();
      return await task();
    } finally {
      release();
    }
  });
}