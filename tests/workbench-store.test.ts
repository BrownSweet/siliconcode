import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkbenchAuth } from "../src/workbench/auth.js";
import { type RequirementDraft, WorkbenchStore } from "../src/workbench/store.js";

const roots: string[] = [];
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "silicon-workbench-store-")));
  roots.push(root);
  const workdir = join(root, "project");
  mkdirSync(workdir);
  const dataDir = join(root, "data");
  return { root, workdir, dataDir, store: new WorkbenchStore(dataDir) };
}
const draft: RequirementDraft = {
  prd: "# PRD",
  sdd: "# SDD",
  acceptance: ["works"],
  questions: [],
  checks: [
    { kind: "test", command: "npm test", timeoutSec: 60 },
    { kind: "build", command: "npm run build", timeoutSec: 60 },
  ],
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("workbench version ownership and immutability", () => {
  it("canonicalizes projects, rejects broad data roots, and enforces ownership", () => {
    const f = fixture();
    symlinkSync(f.workdir, join(f.root, "alias"));
    const p = f.store.addProject("alice", join(f.root, "alias"));
    expect(p.workdir).toBe(f.workdir);
    expect(f.store.addProject("alice", f.workdir).id).toBe(p.id);
    expect(() => f.store.project("bob", p.id)).toThrow("项目不存在");
    expect(() => f.store.addProject("alice", f.root)).toThrow("账户数据");
    expect(() => f.store.addProject("alice", "/")).toThrow();
  });
  it("blocks stale revisions and open questions, preserves confirmed parent documents across upgrades and restart", () => {
    const f = fixture();
    const p = f.store.addProject("alice", f.workdir);
    const v1 = f.store.createVersion("alice", p.id, { label: "1.0", requirement: "make it work" });
    f.store.recordDraft("alice", p.id, v1.id, 0, { ...draft, questions: ["which platform?"] });
    expect(() => f.store.confirm("alice", p.id, v1.id, 1)).toThrow("待澄清");
    f.store.recordDraft("alice", p.id, v1.id, 1, draft);
    expect(() => f.store.confirm("alice", p.id, v1.id, 1)).toThrow("当前");
    f.store.confirm("alice", p.id, v1.id, 2);
    expect(() => f.store.recordDraft("alice", p.id, v1.id, 2, draft)).toThrow("不可修改");
    const v2 = f.store.createVersion("alice", p.id, {
      label: "2.0",
      requirement: "upgrade",
      parentId: v1.id,
    });
    f.store.recordDraft("alice", p.id, v2.id, 0, { ...draft, prd: "# new PRD" });
    const loaded = new WorkbenchStore(f.dataDir);
    expect(loaded.version("alice", p.id, v1.id).revisions[1]?.prd).toBe("# PRD");
    expect(loaded.version("alice", p.id, v2.id).parentId).toBe(v1.id);
    expect(() => loaded.version("bob", p.id, v2.id)).toThrow();
  });
  it("requires real test/build commands before confirmation and rejects a parent from another project", () => {
    const f = fixture();
    const p = f.store.addProject("alice", f.workdir);
    const v = f.store.createVersion("alice", p.id, { label: "1", requirement: "something" });
    f.store.recordDraft("alice", p.id, v.id, 0, { ...draft, checks: [] });
    expect(() => f.store.confirm("alice", p.id, v.id, 1)).toThrow("测试和打包");
    const other = join(f.root, "other");
    mkdirSync(other);
    const p2 = f.store.addProject("alice", other);
    expect(() =>
      f.store.createVersion("alice", p2.id, { label: "2", requirement: "next", parentId: v.id }),
    ).toThrow("不存在");
  });
});

describe("personal account", () => {
  it("hashes credentials, requires setup token, and expires/revokes sessions", async () => {
    const f = fixture();
    let now = Date.now();
    const auth = new WorkbenchAuth(f.dataDir, () => now);
    await expect(auth.setup("wrong", "brown", "safe-password-123")).rejects.toThrow();
    await auth.setup(auth.setupToken, "brown", "safe-password-123");
    expect(readFileSync(join(f.dataDir, "account.json"), "utf8")).not.toContain("safe-password");
    const login = await auth.login("brown", "safe-password-123", "local");
    expect(auth.session(login.token)?.username).toBe("brown");
    expect(() => auth.checkCsrf(login.session, "invalid")).toThrow();
    auth.logout(login.token);
    expect(auth.session(login.token)).toBeNull();
    const next = await auth.login("brown", "safe-password-123", "local");
    now += 12 * 60 * 60 * 1000;
    expect(auth.session(next.token)).toBeNull();
    expect(new WorkbenchAuth(f.dataDir).needsSetup).toBe(false);
  });
  it("allows exactly one concurrent setup and invalidates all sessions on password change", async () => {
    const f = fixture();
    const auth = new WorkbenchAuth(f.dataDir);
    const results = await Promise.allSettled([
      auth.setup(auth.setupToken, "brown", "safe-password-123"),
      auth.setup(auth.setupToken, "brown", "safe-password-123"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const one = await auth.login("brown", "safe-password-123", "local");
    const two = await auth.login("brown", "safe-password-123", "local");
    await auth.changePassword(one.session, "safe-password-123", "updated-password-456");
    expect(auth.session(two.token)).toBeNull();
    await expect(auth.login("brown", "safe-password-123", "local")).rejects.toThrow();
    expect((await auth.login("brown", "updated-password-456", "local")).session.userId).toBe(
      one.session.userId,
    );
  });
  it("limits failed login attempts", async () => {
    const f = fixture();
    const auth = new WorkbenchAuth(f.dataDir);
    for (let i = 0; i < 10; i++)
      await expect(auth.login("bad", "bad", "local")).rejects.toMatchObject({ status: 401 });
    await expect(auth.login("bad", "bad", "local")).rejects.toMatchObject({ status: 429 });
  });
});
