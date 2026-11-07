/**
 * @jest-environment node
 *
 * Stream-bound body reading for the publish endpoints.
 */
import { Readable } from "node:stream";
import { ReadableStream } from "node:stream/web";
import { readBoundedText } from "../bounded-body";
import { MAX_PUBLISH_BODY_BYTES, readJsonBody } from "../publish-request";

const LIMIT = MAX_PUBLISH_BODY_BYTES; // 32 KiB
const encoder = new TextEncoder();

/** A web stream that serves `chunks` and records how many were pulled and whether it was cancelled. */
function webStream(chunks: Uint8Array[], failAt = -1) {
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled === failAt) {
        controller.error(new Error("socket hang up"));
        return;
      }
      if (state.pulled >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[state.pulled++]);
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

const req = (body: unknown, headers: Record<string, string> = {}) =>
  ({ headers: new Headers(headers), body }) as unknown as Request;

const kib = (n: number) => new Uint8Array(n * 1024).fill(0x61); // "a" bytes

describe("readBoundedText", () => {
  it("accepts a small valid JSON body", async () => {
    const { stream } = webStream([encoder.encode('{"a":1}')]);
    expect(await readBoundedText(req(stream), LIMIT)).toEqual({ ok: true, text: '{"a":1}' });
  });

  it("accepts a body of exactly the limit", async () => {
    const { stream } = webStream([kib(16), kib(16)]);
    const read = await readBoundedText(req(stream), LIMIT);
    expect(read.ok && read.text.length).toBe(LIMIT);
  });

  it("rejects a declared oversized Content-Length without reading", async () => {
    const { stream, state } = webStream([kib(1)]);
    expect(await readBoundedText(req(stream, { "Content-Length": String(LIMIT + 1) }), LIMIT)).toEqual({
      ok: false,
      reason: "body_too_large",
    });
    expect(state.pulled).toBe(0);
    expect(state.cancelled).toBe(true);
  });

  it("rejects an oversized body without Content-Length and stops reading early", async () => {
    const chunks = Array.from({ length: 100 }, () => kib(8)); // 800 KiB offered
    const { stream, state } = webStream(chunks);
    expect(await readBoundedText(req(stream), LIMIT)).toEqual({ ok: false, reason: "body_too_large" });
    // Stopped at the 5th chunk (40 KiB > 32 KiB); the stream had buffered at most one more
    expect(state.pulled).toBeLessThanOrEqual(6);
    expect(state.cancelled).toBe(true);
  });

  it("doesn't trust an understated Content-Length", async () => {
    const { stream, state } = webStream([kib(20), kib(20), kib(20)]);
    expect(await readBoundedText(req(stream, { "Content-Length": "10" }), LIMIT)).toEqual({
      ok: false,
      reason: "body_too_large",
    });
    expect(state.cancelled).toBe(true);
  });

  it("counts UTF-8 bytes, not characters", async () => {
    const accents = "é".repeat(20_000); // 20,000 characters, 40,000 bytes
    const { stream } = webStream([encoder.encode(accents)]);
    expect(await readBoundedText(req(stream), LIMIT)).toEqual({ ok: false, reason: "body_too_large" });
  });

  it("keeps valid multibyte text intact, even when a character is split across chunks", async () => {
    const bytes = encoder.encode("Grüße 👋 你好");
    const { stream } = webStream([bytes.slice(0, 3), bytes.slice(3, 11), bytes.slice(11)]);
    expect(await readBoundedText(req(stream), LIMIT)).toEqual({ ok: true, text: "Grüße 👋 你好" });
  });

  it("rejects invalid UTF-8", async () => {
    const { stream } = webStream([new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])]);
    expect(await readBoundedText(req(stream), LIMIT)).toEqual({ ok: false, reason: "invalid_encoding" });
  });

  it("handles a stream that fails mid-read", async () => {
    const { stream } = webStream([kib(1), kib(1)], 1);
    expect(await readBoundedText(req(stream), LIMIT)).toEqual({ ok: false, reason: "unreadable_body" });
  });

  it("supports Node streams and stops them when too large", async () => {
    const node = Readable.from([Buffer.from(kib(20)), Buffer.from(kib(20)), Buffer.from(kib(20))]);
    expect(await readBoundedText(req(node), LIMIT)).toEqual({ ok: false, reason: "body_too_large" });
    expect(node.destroyed).toBe(true);
    expect(await readBoundedText(req(Readable.from([Buffer.from('{"ok":true}')])), LIMIT)).toEqual({
      ok: true,
      text: '{"ok":true}',
    });
  });

  it("treats a missing body as empty", async () => {
    expect(await readBoundedText(req(null), LIMIT)).toEqual({ ok: true, text: "" });
  });
});

describe("readJsonBody", () => {
  it("parses a small body", async () => {
    const { stream } = webStream([encoder.encode('{"title":"Hi"}')]);
    expect(await readJsonBody(req(stream))).toEqual({ ok: true, value: { title: "Hi" } });
  });

  it("returns 413 for an oversized body and 400 for malformed JSON or a failed stream", async () => {
    expect(await readJsonBody(req(webStream([kib(40)]).stream))).toMatchObject({ ok: false, status: 413, reason: "body_too_large" });
    expect(await readJsonBody(req(webStream([encoder.encode("{nope")]).stream))).toMatchObject({ status: 400, reason: "invalid_json" });
    expect(await readJsonBody(req(webStream([kib(1)], 0).stream))).toMatchObject({ status: 400, reason: "unreadable_body" });
  });
});
