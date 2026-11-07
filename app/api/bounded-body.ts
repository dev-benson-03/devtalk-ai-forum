/**
 * Reads a request body with a hard byte limit enforced while the stream is
 * consumed, not afterwards. Content-Length is only a hint: a missing or
 * understated header can't get more than `maxBytes` read into memory.
 *
 * Counts bytes (not string characters), stops reading and cancels the
 * stream as soon as the limit is passed, and decodes strict UTF-8 only
 * after the whole body is within the limit.
 */

export type BodyRead =
  | { ok: true; text: string }
  | { ok: false; reason: "body_too_large" | "unreadable_body" | "invalid_encoding" };

type Chunk = Uint8Array | string;

const toBytes = (chunk: Chunk): Uint8Array =>
  typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;

interface WebStream {
  getReader(): { read(): Promise<{ done: boolean; value?: Chunk }>; cancel(reason?: unknown): Promise<void> };
}
interface NodeStream extends AsyncIterable<Chunk> {
  destroy?(error?: Error): void;
}

const isWebStream = (body: unknown): body is WebStream =>
  typeof (body as WebStream | null)?.getReader === "function";
const isAsyncIterable = (body: unknown): body is NodeStream =>
  typeof (body as NodeStream | null)?.[Symbol.asyncIterator] === "function";

/** Collects chunks until the source ends or the limit is passed. */
async function collect(
  next: () => Promise<{ done: boolean; value?: Chunk }>,
  stop: () => Promise<void> | void,
  maxBytes: number
): Promise<Uint8Array[] | "too_large"> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await next();
    if (done) return chunks;
    if (value === undefined) continue;
    const bytes = toBytes(value);
    total += bytes.byteLength;
    if (total > maxBytes) {
      try {
        await stop(); // release the stream; the rest is never read
      } catch {
        // already closed or errored: nothing more to release
      }
      return "too_large";
    }
    chunks.push(bytes);
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function readBoundedText(request: Pick<Request, "headers" | "body">, maxBytes: number): Promise<BodyRead> {
  const body: unknown = request.body;
  const declared = Number(request.headers?.get?.("Content-Length") ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    if (isWebStream(body)) await body.getReader().cancel().catch(() => {});
    else (body as NodeStream | null)?.destroy?.();
    return { ok: false, reason: "body_too_large" };
  }

  let chunks: Uint8Array[] | "too_large";
  try {
    if (body === null || body === undefined) {
      chunks = [];
    } else if (body instanceof Uint8Array || typeof body === "string") {
      // Some runtimes (and test polyfills) hand over an already-buffered body
      const bytes = toBytes(body);
      chunks = bytes.byteLength > maxBytes ? "too_large" : [bytes];
    } else if (isWebStream(body)) {
      const reader = body.getReader();
      chunks = await collect(() => reader.read(), () => reader.cancel(), maxBytes);
    } else if (isAsyncIterable(body)) {
      const iterator = body[Symbol.asyncIterator]();
      chunks = await collect(
        async () => {
          const r = await iterator.next();
          return { done: r.done === true, value: r.done ? undefined : r.value };
        },
        () => {
          body.destroy?.();
        },
        maxBytes
      );
    } else {
      return { ok: false, reason: "unreadable_body" };
    }
  } catch {
    return { ok: false, reason: "unreadable_body" }; // the stream failed mid-read
  }
  if (chunks === "too_large") return { ok: false, reason: "body_too_large" };

  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(concat(chunks)) };
  } catch {
    return { ok: false, reason: "invalid_encoding" };
  }
}
