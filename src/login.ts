// GitHub 登录状态：`gh auth status --json hosts` 给账号与 scopes，
// 一次只读 `gh api user` 验证凭据是否仍然有效。不读取 token 本身。

import { GhError, type GhTransport } from './gh.ts';
import type { PollSummary } from './poller.ts';

export type ApiState = 'ok' | 'expired' | 'error' | 'unknown';
export type NotificationsScope = 'ok' | 'missing' | 'unknown';
export type LoginReason = 'gh-missing' | 'not-logged-in' | 'credential' | 'network' | 'api-error' | 'unknown';

export interface LoginSnapshot {
  installed: boolean;
  authenticated: boolean;
  api: ApiState;
  notifications: NotificationsScope;
  scopes: string[];
  username?: string;
  tokenSource?: string;
  checkedAt?: number;
  detail?: string;
  reason?: LoginReason;
}

export function initialLogin(): LoginSnapshot {
  return {
    installed: true,
    authenticated: false,
    api: 'unknown',
    notifications: 'unknown',
    scopes: [],
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export interface ParsedAuth {
  authenticated: boolean;
  username?: string;
  tokenSource?: string;
  scopes: string[];
  detail?: string;
}

/** 解析 `gh auth status --json hosts` 的当前账号。 */
export function parseAuthStatus(stdout: string): ParsedAuth {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    return { authenticated: false, scopes: [], detail: 'gh auth status 输出不是合法 JSON' };
  }
  if (!isRecord(parsed) || !isRecord(parsed.hosts)) {
    return { authenticated: false, scopes: [], detail: 'gh auth status 缺少 hosts' };
  }
  let candidate: Record<string, unknown> | undefined;
  let fallback: Record<string, unknown> | undefined;
  for (const entries of Object.values(parsed.hosts)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      fallback ??= entry;
      if (entry.active === true) candidate = entry;
    }
  }
  const chosen = candidate ?? fallback;
  if (chosen === undefined) return { authenticated: false, scopes: [], detail: '没有已登录的 GitHub 账号' };
  const scopes = typeof chosen.scopes === 'string'
    ? chosen.scopes.split(',').map((scope) => scope.trim()).filter((scope) => scope !== '')
    : [];
  const result: ParsedAuth = {
    authenticated: chosen.state === 'success',
    scopes,
  };
  if (typeof chosen.login === 'string' && chosen.login !== '') result.username = chosen.login;
  if (typeof chosen.tokenSource === 'string' && chosen.tokenSource !== '') result.tokenSource = chosen.tokenSource;
  if (result.authenticated === false) result.detail = 'gh 账号状态不是 success';
  return result;
}

export function hasNotificationsScope(scopes: readonly string[]): NotificationsScope {
  if (scopes.length === 0) return 'unknown';
  return scopes.includes('notifications') || scopes.includes('repo') ? 'ok' : 'missing';
}

export function parseUserLogin(stdout: string): string | undefined {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (isRecord(parsed) && typeof parsed.login === 'string' && parsed.login !== '') return parsed.login;
  } catch {
    // 由调用方按 API 错误处理。
  }
  return undefined;
}

function failure(reason: LoginReason, detail: string): LoginSnapshot {
  return {
    ...initialLogin(),
    installed: reason !== 'gh-missing',
    api: reason === 'credential' ? 'expired' : reason === 'api-error' || reason === 'network' ? 'error' : 'unknown',
    reason,
    detail,
  };
}

/** 显式检查：本地 auth 状态 + 一次只读 API 探测。 */
export async function probeLogin(transport: GhTransport, timeoutMs: number): Promise<LoginSnapshot> {
  const checkedAt = Date.now();
  let stdout: string;
  try {
    stdout = await transport.exec(['auth', 'status', '--json', 'hosts'], Math.min(timeoutMs, 8_000));
  } catch (error) {
    if (error instanceof GhError) {
      if (error.kind === 'not-installed') return { ...failure('gh-missing', error.detail), checkedAt };
      const notLoggedIn = /not logged into any github hosts|not logged in|no oauth token/i.test(error.detail);
      return {
        ...failure(notLoggedIn ? 'not-logged-in' : 'unknown', error.detail),
        installed: true,
        checkedAt,
      };
    }
    return { ...failure('unknown', error instanceof Error ? error.message : String(error)), checkedAt };
  }

  const parsed = parseAuthStatus(stdout);
  const snapshot: LoginSnapshot = {
    installed: true,
    authenticated: parsed.authenticated,
    api: 'unknown',
    notifications: hasNotificationsScope(parsed.scopes),
    scopes: [...parsed.scopes],
    checkedAt,
  };
  if (parsed.username !== undefined) snapshot.username = parsed.username;
  if (parsed.tokenSource !== undefined) snapshot.tokenSource = parsed.tokenSource;
  if (parsed.detail !== undefined) snapshot.detail = parsed.detail;
  if (!parsed.authenticated) {
    snapshot.reason = 'not-logged-in';
    return snapshot;
  }

  try {
    const response = await transport.api({ endpoint: 'user' }, timeoutMs);
    const username = parseUserLogin(response.body);
    if (username !== undefined) snapshot.username = username;
    const headerScopes = response.headers['x-oauth-scopes'];
    if (headerScopes !== undefined && snapshot.scopes.length === 0) {
      snapshot.scopes = headerScopes.split(',').map((scope) => scope.trim()).filter((scope) => scope !== '');
      snapshot.notifications = hasNotificationsScope(snapshot.scopes);
    }
    snapshot.api = 'ok';
    delete snapshot.reason;
    delete snapshot.detail;
  } catch (error) {
    if (error instanceof GhError && error.kind === 'unauthenticated') {
      snapshot.api = 'expired';
      snapshot.reason = 'credential';
      snapshot.detail = error.detail;
    } else {
      snapshot.api = 'error';
      snapshot.reason = error instanceof GhError && error.kind === 'network' ? 'network' : 'api-error';
      snapshot.detail = error instanceof Error ? error.message : String(error);
    }
  }
  return snapshot;
}

/** 每轮轮询后用实际结果修正登录态；它比显式检查更及时。 */
export function loginFromPoll(previous: LoginSnapshot, summary: PollSummary): LoginSnapshot {
  if (!summary.authenticated) {
    return {
      ...previous,
      installed: true,
      authenticated: false,
      api: 'expired',
      checkedAt: summary.at,
      detail: summary.errors[0] ?? 'GitHub 凭据失效',
      reason: 'credential',
    };
  }
  if (summary.errors.length === 0) {
    const next: LoginSnapshot = {
      ...previous,
      installed: true,
      authenticated: true,
      api: 'ok',
      checkedAt: summary.at,
    };
    delete next.detail;
    delete next.reason;
    return next;
  }
  return {
    ...previous,
    installed: true,
    checkedAt: summary.at,
    detail: summary.errors[0],
  };
}
