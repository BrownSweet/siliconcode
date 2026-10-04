import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { promisify } from "node:util";
import { WorkbenchError, atomicJson, readJson } from "./store.js";

const derive = promisify(scrypt);
const SESSION_MS = 12 * 60 * 60 * 1000;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
function equals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
interface Account {
  id: string;
  username: string;
  salt: string;
  passwordHash: string;
}
export interface BrowserSession {
  userId: string;
  username: string;
  csrf: string;
  expiresAt: number;
}

/** Personal administrator account. Shell execution runs with the service OS user's rights. */
export class WorkbenchAuth {
  private account: Account | null;
  private sessions = new Map<string, BrowserSession>();
  private attempts = new Map<string, { count: number; resetAt: number }>();
  readonly setupToken = randomBytes(24).toString("hex");
  constructor(
    private dataDir: string,
    private now = Date.now,
  ) {
    this.account = readJson<Account | null>(join(dataDir, "account.json"), null);
  }
  get needsSetup(): boolean {
    return this.account === null;
  }

  async setup(token: string, username: string, password: string): Promise<void> {
    if (this.account || !equals(token, this.setupToken))
      throw new WorkbenchError(403, "设置凭据无效或账户已创建");
    const next = await this.hashAccount(username, password);
    // Recheck after async scrypt: only one concurrent setup may win.
    if (this.account) throw new WorkbenchError(409, "账户已创建");
    atomicJson(join(this.dataDir, "account.json"), next);
    this.account = next;
  }

  async login(
    username: string,
    password: string,
    remote: string,
  ): Promise<{ token: string; session: BrowserSession }> {
    const time = this.now();
    for (const [key, item] of this.attempts) if (item.resetAt <= time) this.attempts.delete(key);
    const attempts = this.attempts.get(remote) ?? { count: 0, resetAt: time + 60_000 };
    if (attempts.count >= 10) throw new WorkbenchError(429, "登录尝试过多，请一分钟后重试");
    attempts.count++;
    this.attempts.set(remote, attempts);
    if (password.length > 1024 || username.length > 120)
      throw new WorkbenchError(401, "用户名或密码错误");
    const account = this.account;
    const computed = (await derive(password, account?.salt ?? "invalid-account", 64)) as Buffer;
    if (
      !account ||
      this.account !== account ||
      !equals(username, account.username) ||
      !equals(computed.toString("hex"), account.passwordHash)
    ) {
      throw new WorkbenchError(401, "用户名或密码错误");
    }
    this.attempts.delete(remote);
    this.prune();
    const token = randomBytes(32).toString("hex");
    const session: BrowserSession = {
      userId: account.id,
      username: account.username,
      csrf: randomBytes(32).toString("hex"),
      expiresAt: time + SESSION_MS,
    };
    this.sessions.set(digest(token), session);
    // Bound memory even when a client repeatedly logs in.
    if (this.sessions.size > 100) this.sessions.delete(this.sessions.keys().next().value!);
    return { token, session: { ...session } };
  }
  session(token: string): BrowserSession | null {
    this.prune();
    const s = this.sessions.get(digest(token));
    return s ? { ...s } : null;
  }
  checkCsrf(session: BrowserSession, csrf: string): void {
    if (!equals(session.csrf, csrf)) throw new WorkbenchError(403, "CSRF 校验失败，请刷新页面");
  }
  logout(token: string): void {
    this.sessions.delete(digest(token));
  }
  async changePassword(
    session: BrowserSession,
    oldPassword: string,
    password: string,
  ): Promise<void> {
    const previous = this.account;
    if (!previous || previous.id !== session.userId || oldPassword.length > 1024)
      throw new WorkbenchError(401, "请重新登录");
    const hash = (await derive(oldPassword, previous.salt, 64)) as Buffer;
    if (!equals(hash.toString("hex"), previous.passwordHash))
      throw new WorkbenchError(403, "原密码错误");
    const next = await this.hashAccount(previous.username, password, previous.id);
    if (this.account !== previous) throw new WorkbenchError(409, "密码已变更，请重新登录");
    atomicJson(join(this.dataDir, "account.json"), next);
    this.account = next;
    this.sessions.clear();
  }
  private async hashAccount(
    username: string,
    password: string,
    id: string = randomUUID(),
  ): Promise<Account> {
    if (
      !/^[\p{L}\p{N}_.@-]{1,80}$/u.test(username) ||
      password.length < 12 ||
      password.length > 1024
    ) {
      throw new WorkbenchError(400, "用户名限 1–80 个字母、数字或 _.@-；密码需 12–1024 个字符");
    }
    const salt = randomBytes(32).toString("hex");
    const hash = (await derive(password, salt, 64)) as Buffer;
    return { id, username, salt, passwordHash: hash.toString("hex") };
  }
  private prune(): void {
    for (const [key, session] of this.sessions)
      if (session.expiresAt <= this.now()) this.sessions.delete(key);
  }
}
