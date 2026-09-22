import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "../../version.js";
import { type DashboardContext, resolveSiliconcodeHome } from "../context.js";
import type { ApiResult } from "../router.js";

interface DirStat {
  path: string;
  exists: boolean;
  fileCount: number;
  totalBytes: number;
}

/** Sum file sizes one level deep. Recursion deferred until we have a use-case for nested data dirs. */
function dirSize(path: string): DirStat {
  if (!existsSync(path)) return { path, exists: false, fileCount: 0, totalBytes: 0 };
  let fileCount = 0;
  let totalBytes = 0;
  try {
    const entries = readdirSync(path);
    for (const name of entries) {
      const full = join(path, name);
      try {
        const s = statSync(full);
        if (s.isFile()) {
          fileCount++;
          totalBytes += s.size;
        } else if (s.isDirectory()) {
          // Recurse one level for nested folders (memory/<hash>, sessions/, etc).
          try {
            const inner = readdirSync(full);
            for (const child of inner) {
              try {
                const cs = statSync(join(full, child));
                if (cs.isFile()) {
                  fileCount++;
                  totalBytes += cs.size;
                }
              } catch {
                /* skip */
              }
            }
          } catch {
            /* skip */
          }
        }
      } catch {
        /* skip — file might have been deleted between readdir + stat */
      }
    }
  } catch {
    return { path, exists: true, fileCount: 0, totalBytes: 0 };
  }
  return { path, exists: true, fileCount, totalBytes };
}

function countSessionFiles(path: string): number {
  if (!existsSync(path)) return 0;
  try {
    return readdirSync(path).filter(
      (file) => file.endsWith(".jsonl") && !file.endsWith(".events.jsonl"),
    ).length;
  } catch {
    return 0;
  }
}

export async function handleHealth(
  method: string,
  _rest: string[],
  _body: string,
  ctx: DashboardContext,
): Promise<ApiResult> {
  if (method !== "GET") {
    return { status: 405, body: { error: "GET only" } };
  }
  const siliconcodeHome = resolveSiliconcodeHome(ctx.configPath);

  const sessionsStat = dirSize(join(siliconcodeHome, "sessions"));
  const memoryStat = dirSize(join(siliconcodeHome, "memory"));
  const semanticStat = dirSize(join(siliconcodeHome, "semantic"));

  let usageBytes = 0;
  if (existsSync(ctx.usageLogPath)) {
    try {
      usageBytes = statSync(ctx.usageLogPath).size;
    } catch {
      /* ignore */
    }
  }

  return {
    status: 200,
    body: {
      version: VERSION,
      latestVersion: ctx.getLatestVersion?.() ?? null,
      siliconcodeHome,
      sessions: {
        path: sessionsStat.path,
        count: countSessionFiles(sessionsStat.path),
        totalBytes: sessionsStat.totalBytes,
      },
      memory: {
        path: memoryStat.path,
        fileCount: memoryStat.fileCount,
        totalBytes: memoryStat.totalBytes,
      },
      semantic: {
        path: semanticStat.path,
        exists: semanticStat.exists,
        fileCount: semanticStat.fileCount,
        totalBytes: semanticStat.totalBytes,
      },
      usageLog: {
        path: ctx.usageLogPath,
        bytes: usageBytes,
      },
      jobs: ctx.jobs ? ctx.jobs.list().length : null,
    },
  };
}
