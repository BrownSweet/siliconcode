import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, parse, relative, resolve } from "node:path";

const within = (path: string, root: string) => {
  const rel = relative(root, path);
  return (
    rel === "" ||
    (rel !== ".." &&
      !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      !isAbsolute(rel))
  );
};
const canonical = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

/** Shared by browsing, native selection and project creation; paths are canonical. */
export function projectDirectoryAccess(path: string, dataDir: string) {
  return createProjectDirectoryPolicy(dataDir)(path);
}

export function createProjectDirectoryPolicy(dataDir: string) {
  const home = canonical(homedir());
  const state = canonical(dataDir);
  const protectedTrees = [
    state,
    ...[".ssh", ".aws", ".gnupg", ".kube", ".config", ".codex", ".siliconcode"].map((name) =>
      canonical(join(home, name)),
    ),
    ...["/etc", "/usr", "/bin", "/sbin", "/root", "/boot", "/sys", "/proc", "/dev"]
      .filter(() => process.platform !== "win32")
      .map(canonical),
  ];
  const systemVar = process.platform !== "win32" ? canonical("/var") : undefined;
  return (path: string) => {
    const browse = !protectedTrees.some((root) => within(path, root));
    // /var itself is too broad as a project, but /var/www and OS temp projects are valid.
    const selectable =
      browse &&
      path !== home &&
      path !== parse(path).root &&
      path !== systemVar &&
      !protectedTrees.some((root) => within(root, path));
    return {
      browse,
      selectable,
      reason: selectable ? "" : "不能选择系统、密钥目录或包含工作台账户数据的目录",
    };
  };
}
