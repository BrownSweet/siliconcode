import type { ServerResponse } from "node:http";
import type { TaskEvent } from "./runtime.js";

/** One ordered stream owns replay, live handoff, backpressure and cancellation. */
export function streamTaskEvents(
  res: ServerResponse,
  options: {
    after: number;
    history: (signal: AbortSignal) => AsyncIterable<TaskEvent>;
    subscribe: (listener: (event: TaskEvent) => void) => () => void;
    authenticated: () => boolean;
    onClose: () => void;
  },
): void {
  const abort = new AbortController();
  let cursor = options.after;
  let closed = false;
  let replayed = false;
  let writing = false;
  let unsubscribe = () => {};
  const pending: Array<{ event: TaskEvent; frame: string; bytes: number }> = [];
  let pendingBytes = 0;
  const heartbeat = setInterval(() => {
    if (!options.authenticated()) close();
    else if (!writing && !res.writableNeedDrain) res.write(": heartbeat\n\n");
  }, 15_000);
  function close() {
    if (closed) return;
    closed = true;
    abort.abort();
    clearInterval(heartbeat);
    unsubscribe();
    pending.length = 0;
    pendingBytes = 0;
    options.onClose();
    if (!res.destroyed) res.end();
  }
  res.once("close", close);
  res.once("error", close);
  async function write(event: TaskEvent, frame?: string): Promise<void> {
    if (closed || event.seq <= cursor) return;
    if (!res.write(frame ?? `id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`)) {
      await new Promise<void>((resolve) => {
        const done = () => {
          res.off("drain", done);
          abort.signal.removeEventListener("abort", done);
          resolve();
        };
        res.once("drain", done);
        abort.signal.addEventListener("abort", done, { once: true });
        if (abort.signal.aborted) done();
      });
    }
    cursor = event.seq;
  }
  async function flush(): Promise<void> {
    if (writing || closed) return;
    writing = true;
    try {
      while (pending.length && !closed) {
        const next = pending.shift()!;
        pendingBytes -= next.bytes;
        await write(next.event, next.frame);
      }
    } finally {
      writing = false;
    }
  }
  // Subscribe before taking the file snapshot; replay can include these same events.
  unsubscribe = options.subscribe((event) => {
    if (closed || event.seq <= cursor) return;
    const frame = `id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`;
    const bytes = Buffer.byteLength(frame);
    pendingBytes += bytes;
    // A stalled client resumes from its last received id; all events remain on disk.
    if (pendingBytes > 8 * 1024 * 1024) {
      close();
      return;
    }
    pending.push({ event, frame, bytes });
    if (replayed) void flush().catch(close);
  });
  if (closed) {
    unsubscribe();
    return;
  }
  res.flushHeaders();
  void (async () => {
    writing = true;
    try {
      for await (const event of options.history(abort.signal)) {
        if (closed) break;
        await write(event);
      }
    } finally {
      writing = false;
    }
    replayed = true;
    await flush();
  })().catch(close);
}
