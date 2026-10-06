declare const __SILICONCODE_BASE_PATH__: string | undefined;

// The server supplies the active mount, including when a build is relocated at runtime.
export const BASE_PATH =
  document.querySelector('meta[name="siliconcode-base-path"]')?.getAttribute("content") ??
  (typeof __SILICONCODE_BASE_PATH__ === "string" ? __SILICONCODE_BASE_PATH__ : "/");

export function appUrl(path: string): string {
  return `${BASE_PATH}${path.replace(/^\/+/, "")}`;
}
