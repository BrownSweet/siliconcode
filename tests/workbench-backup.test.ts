import { randomUUID } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, expect, it } from "vitest";
import { WorkbenchAuth } from "../src/workbench/auth.js";
import { exportWorkbench, restoreWorkbench } from "../src/workbench/backup.js";
import { WorkbenchStore } from "../src/workbench/store.js";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "silicon-backup-"));
  roots.push(root);
  const source = join(root, "source");
  const store = new WorkbenchStore(source);
  const auth = new WorkbenchAuth(source);
  await auth.setup(auth.setupToken, "fixture-user", "fixture-password-123");
  const owner = (await auth.login("fixture-user", "fixture-password-123", "local")).session.userId;
  const projectPath = join(root, "repo");
  mkdirSync(projectPath);
  const project = store.addProject(owner, projectPath);
  const version = store.createVersion(owner, project.id, { label: "1.0", requirement: "中文需求" });
  store.saveSettings({ maxTokens: 5000, budgetUsd: null });
  mkdirSync(join(source, "tasks"));
  const logName = `${randomUUID()}.jsonl`;
  writeFileSync(
    join(source, "tasks", logName),
    `${JSON.stringify({ seq: 1, data: "x".repeat(4000) })}\n`.repeat(1000),
  );
  writeFileSync(join(source, "server.lock"), "do not restore");
  writeFileSync(join(source, "config.json"), '{"apiKey":"must-not-export"}');
  const archive = join(root, "backup.scwb.gz");
  await exportWorkbench(source, createWriteStream(archive, { mode: 0o600 }));
  return { root, source, archive, owner, project, version, logName };
}
it("round-trips large records, original login and immutable requirements into a new store", async () => {
  const f = await fixture();
  const target = join(f.root, "restored");
  await restoreWorkbench(f.archive, target);
  const login = await new WorkbenchAuth(target).login(
    "fixture-user",
    "fixture-password-123",
    "local",
  );
  expect(login.session.userId).toBe(f.owner);
  const store = new WorkbenchStore(target);
  expect(store.version(f.owner, f.project.id, f.version.id)).toEqual(f.version);
  expect(store.settings()).toEqual({ maxTokens: 5000, budgetUsd: null });
  expect(readFileSync(join(target, "tasks", f.logName))).toEqual(
    readFileSync(join(f.source, "tasks", f.logName)),
  );
  expect(existsSync(join(target, "server.lock"))).toBe(false);
  expect(existsSync(join(target, "config.json"))).toBe(false);
  await expect(restoreWorkbench(f.archive, target)).rejects.toThrow("空目录");
  expect(store.version(f.owner, f.project.id, f.version.id)).toEqual(f.version);
});
it("rejects truncation, tampering, unsupported formats and path traversal without publishing partial data", async () => {
  const f = await fixture();
  const raw = gunzipSync(readFileSync(f.archive)).toString();
  const cases = [
    raw.replace('"version":1', '"version":99'),
    raw.replace('"path":"account.json"', '"path":"../outside.json"'),
    raw.replace(/"sha256":"[a-f0-9]+"/, '"sha256":"bad"'),
    raw.slice(0, raw.lastIndexOf('{"kind":"complete"')),
  ];
  for (const [index, bad] of cases.entries()) {
    const archive = join(f.root, `bad-${index}.gz`);
    writeFileSync(archive, gzipSync(bad));
    const target = join(f.root, `target-${index}`);
    await expect(restoreWorkbench(archive, target)).rejects.toThrow();
    expect(existsSync(target)).toBe(false);
  }
  expect(readdirSync(f.root).filter((name) => name.includes(".restore-"))).toEqual([]);
  expect(existsSync(join(f.root, "outside.json"))).toBe(false);
});
