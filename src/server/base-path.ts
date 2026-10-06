import type { ServerResponse } from "node:http";

declare const __SILICONCODE_BASE_PATH__: string | undefined;

export function normalizeBasePath(value: string): string {
  const path = value.trim() || "/";
  if (!/^(?:\/[A-Za-z0-9_-]+)*\/?$/.test(path)) {
    throw new Error("SILICONCODE_BASE_PATH 必须为 / 或 /siliconcode/ 这样的绝对路径");
  }
  return path.endsWith("/") ? path : `${path}/`;
}

export function getBasePath(): string {
  return normalizeBasePath(
    process.env.SILICONCODE_BASE_PATH ??
      (typeof __SILICONCODE_BASE_PATH__ === "string" ? __SILICONCODE_BASE_PATH__ : "/"),
  );
}

/** Resolve only this application's mount; keep sibling applications out of its router. */
export function routeUnderBase(url: URL, res: ServerResponse, basePath: string): string | null {
  if (basePath !== "/" && url.pathname === basePath.slice(0, -1)) {
    res.writeHead(308, { location: `${basePath}${url.search}` });
    res.end();
    return null;
  }
  if (!url.pathname.startsWith(basePath)) {
    res.writeHead(404);
    res.end("not found");
    return null;
  }
  return `/${url.pathname.slice(basePath.length)}`;
}
