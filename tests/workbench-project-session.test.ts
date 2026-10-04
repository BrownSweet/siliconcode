import { afterEach, describe, expect, it, vi } from "vitest";
import { newRequirementInput, watchProjectActivity } from "../dashboard/src/lib/project-session.js";

afterEach(() => vi.useRealTimers());
describe("project activity independent of conversation selection", () => {
  it("keeps updating the project while another version is viewed, including approval and completion", async () => {
    vi.useFakeTimers();
    let status = "running";
    const load = vi.fn(async () => [{ id: "task-b", status }]);
    const seen: string[] = [];
    const stop = watchProjectActivity({
      load,
      changed: async () => {
        seen.push(status);
      },
      error: () => {},
      intervalMs: 10,
    });
    await vi.advanceTimersByTimeAsync(1);
    // No selection is passed to the project watcher: viewing A must not stop B.
    status = "waiting_for_approval";
    await vi.advanceTimersByTimeAsync(10);
    status = "completed";
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(20);
    expect(seen).toEqual(["running", "waiting_for_approval", "completed"]);
    stop();
    const count = load.mock.calls.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(load).toHaveBeenCalledTimes(count);
  });
  it("ignores an old project's delayed response after switching and retries transient errors", async () => {
    vi.useFakeTimers();
    let resolve!: (value: unknown) => void;
    const changed = vi.fn(async () => {});
    const stop = watchProjectActivity({
      load: () =>
        new Promise((r) => {
          resolve = r;
        }),
      changed,
      error: () => {},
    });
    stop();
    resolve(["old project"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(changed).not.toHaveBeenCalled();
    const error = vi.fn();
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(["new project"]);
    const end = watchProjectActivity({ load, changed, error, intervalMs: 10 });
    await vi.advanceTimersByTimeAsync(11);
    expect(error).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(1);
    end();
  });
  it("does not allow a derived draft to cross projects or use an unconfirmed parent", () => {
    const draft = { projectId: "a", label: "2.0", parentId: "v-a", text: "upgrade" };
    expect(() => newRequirementInput("b", draft, [])).toThrow("项目已切换");
    expect(() => newRequirementInput("b", { ...draft, projectId: "b" }, [])).toThrow("父版本");
    expect(() => newRequirementInput("a", draft, [{ id: "v-a" }])).toThrow("尚未确认");
    expect(newRequirementInput("a", draft, [{ id: "v-a", confirmed: { revision: 1 } }])).toEqual({
      label: "2.0",
      parentId: "v-a",
      requirement: "upgrade",
    });
    expect(
      newRequirementInput("b", { projectId: "b", label: "1.0", parentId: "", text: "new" }, []),
    ).toEqual({ label: "1.0", requirement: "new" });
  });
});

describe("persisted composer drafts", () => {
  it("restores text, label and parent together without crossing account, project or version", async () => {
    const { draftScope, readComposerDraft } = await import(
      "../dashboard/src/lib/project-session.js"
    );
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null };
    const a = draftScope("owner", "project-a", "");
    const b = draftScope("owner", "project-b", "");
    const input = { text: "未发送的需求", label: "2.0", parentId: "parent-a" };
    values.set(a, JSON.stringify(input));
    expect(readComposerDraft(storage, a)).toEqual(input);
    expect(readComposerDraft(storage, b)).toEqual({ text: "", label: "1.0", parentId: "" });
    expect(readComposerDraft(storage, draftScope("other", "project-a", "")).text).toBe("");
    expect(readComposerDraft(storage, draftScope("owner", "project-a", "v1")).text).toBe("");
    values.set(b, "broken JSON");
    expect(readComposerDraft(storage, b).text).toBe("");
    expect(readComposerDraft(storage, a)).toEqual(input);
  });
});
