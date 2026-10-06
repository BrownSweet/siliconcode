import { afterEach, describe, expect, it, vi } from "vitest";

type MetaMap = Record<string, string | undefined>;

const originalDocument = globalThis.document;

function installDocumentMeta(meta: MetaMap): void {
  globalThis.document = {
    querySelector(selector: string) {
      const match = selector.match(/^meta\[name="([^"]+)"\]$/);
      const name = match?.[1];
      const value = name ? meta[name] : undefined;
      return value === undefined ? null : { getAttribute: () => value };
    },
  } as Document;
}

async function loadApiMeta(meta: MetaMap): Promise<{ token: string; mode: string }> {
  vi.resetModules();
  installDocumentMeta(meta);
  const mod = await import("../dashboard/src/lib/api.js");
  return { token: mod.TOKEN, mode: mod.MODE };
}

describe("dashboard API meta tags", () => {
  afterEach(() => {
    vi.resetModules();
    globalThis.document = originalDocument;
  });

  it("sends browser API requests under the server-provided mount", async () => {
    vi.resetModules();
    installDocumentMeta({
      "siliconcode-base-path": "/siliconcode/",
      "siliconcode-token": "test-token",
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"ok":true}'));
    try {
      const { api } = await import("../dashboard/src/lib/api.js");
      await api("/settings");
      expect(fetchMock).toHaveBeenCalledWith(
        "/siliconcode/api/settings?token=test-token",
        expect.any(Object),
      );
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("prefers Silicon meta tags for token and mode", async () => {
    await expect(
      loadApiMeta({
        "siliconcode-token": "carbon-token",
        "reasonix-token": "legacy-token",
        "siliconcode-mode": "attached",
        "reasonix-mode": "standalone",
      }),
    ).resolves.toEqual({ token: "carbon-token", mode: "attached" });
  });

  it("keeps Reasonix meta tags as legacy fallbacks", async () => {
    await expect(
      loadApiMeta({
        "reasonix-token": "legacy-token",
        "reasonix-mode": "attached",
      }),
    ).resolves.toEqual({ token: "legacy-token", mode: "attached" });
  });

  it("defaults to empty token and standalone mode when meta tags are absent", async () => {
    await expect(loadApiMeta({})).resolves.toEqual({ token: "", mode: "standalone" });
  });
});
