import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deliveryRunDir } from "./paths.js";

interface DeliveryLockRecord {
  token: string;
  pid: number;
  createdAt: string;
}

export interface DeliveryRunLock {
  path: string;
  release(): void;
}

function processExists(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLock(path: string): DeliveryLockRecord | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as DeliveryLockRecord;
  } catch {
    return null;
  }
}

export function acquireDeliveryRunLock(workspaceRoot: string, runId: string): DeliveryRunLock {
  const dir = deliveryRunDir(workspaceRoot, runId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "runner.lock");
  const token = randomUUID();
  const record: DeliveryLockRecord = {
    token,
    pid: process.pid,
    createdAt: new Date().toISOString(),
  };

  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = readLock(path);
    if (existing && processExists(existing.pid)) {
      throw new Error(
        `delivery run ${runId} is already controlled by process ${existing.pid} since ${existing.createdAt}`,
      );
    }
    unlinkSync(path);
    fd = openSync(path, "wx", 0o600);
  }
  writeFileSync(fd, `${JSON.stringify(record)}\n`, "utf8");
  closeSync(fd);

  let released = false;
  return {
    path,
    release() {
      if (released) return;
      released = true;
      const current = readLock(path);
      if (current?.token === token) {
        try {
          unlinkSync(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    },
  };
}
