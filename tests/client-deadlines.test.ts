import { describe, expect, it, vi } from "vitest";
import { DeepSeekClient } from "../src/client.js";

const request = { model: "deepseek-v4-flash", messages: [] };

function waitingFetch(): typeof fetch {
  return vi.fn(async (_url, init) => {
    const signal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      if (signal?.aborted) reject(signal.reason);
      else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
}

async function collect(client: DeepSeekClient, signal?: AbortSignal): Promise<string> {
  let text = "";
  for await (const chunk of client.stream({ ...request, signal })) text += chunk.contentDelta ?? "";
  return text;
}

describe("model request deadlines", () => {
  it.each(["chat", "stream"] as const)(
    "enforces %s timeout even with a caller signal",
    async (mode) => {
      const controller = new AbortController();
      const fetch = waitingFetch();
      const client = new DeepSeekClient({
        apiKey: "test",
        timeoutMs: 25,
        fetch,
        retry: { maxAttempts: 1 },
      });
      const response =
        mode === "chat"
          ? client.chat({ ...request, signal: controller.signal })
          : collect(client, controller.signal);
      await expect(response).rejects.toThrow(/timed out/);
      expect(controller.signal.aborted).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("cancels a silent open stream without retrying a partial answer", async () => {
    const cancel = vi.fn();
    const fetch = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
              );
            },
            cancel,
          }),
        ),
    );
    const client = new DeepSeekClient({
      apiKey: "test",
      fetch,
      timeoutMs: 1000,
      streamIdleTimeoutMs: 25,
    });
    await expect(collect(client, new AbortController().signal)).rejects.toThrow(/idle timeout/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("reports premature EOF instead of accepting a partial answer as completed", async () => {
    const fetch = vi.fn(
      async () => new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
    );
    const client = new DeepSeekClient({ apiKey: "test", fetch });
    const received: string[] = [];
    await expect(
      (async () => {
        for await (const chunk of client.stream(request)) received.push(chunk.contentDelta ?? "");
      })(),
    ).rejects.toThrow(/disconnected before completion/);
    expect(received.join("")).toBe("partial");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps explicit user cancellation distinct from a timeout", async () => {
    const controller = new AbortController();
    const client = new DeepSeekClient({ apiKey: "test", fetch: waitingFetch(), timeoutMs: 1000 });
    const response = client.chat({ ...request, signal: controller.signal });
    controller.abort(new DOMException("user stopped", "AbortError"));
    await expect(response).rejects.toMatchObject({ name: "AbortError", message: "user stopped" });
  });

  it("requires a Responses terminal event even if a relay sends a bare DONE marker", async () => {
    const client = new DeepSeekClient({
      apiKey: "test",
      wireApi: "responses",
      fetch: async () =>
        new Response(
          'data: {"type":"response.output_text.delta","delta":"partial"}\n\ndata: [DONE]\n\n',
        ),
    });
    await expect(collect(client)).rejects.toThrow(/response.completed/);
  });
});
