// gh 子进程封装：只读 API 调用、最小环境、超时与错误分类。
// 不传 GH_TOKEN / GITHUB_TOKEN，让 gh 使用本机 keyring；不读、不记录任何凭据。

import { spawn } from 'node:child_process';

export interface CommandRunner {
  run(args: string[], timeoutMs: number): Promise<string>;
}

export interface GhRequest {
  /** 例如 `search/issues`、`notifications`、`repos/o/r/pulls/1`。 */
  endpoint: string;
  /** 追加到 query string 的参数；undefined 的项被跳过。 */
  params?: Record<string, string | number | boolean | undefined>;
  /** 额外的请求头，例如 If-None-Match。 */
  headers?: Record<string, string>;
}

export interface GhResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type GhErrorKind =
  | 'not-installed'
  | 'unauthenticated'
  | 'forbidden'
  | 'rate-limited'
  | 'not-found'
  | 'invalid'
  | 'network'
  | 'timeout'
  | 'invalid-output'
  | 'other';

export class GhError extends Error {
  readonly kind: GhErrorKind;
  readonly status?: number;
  readonly detail: string;
  readonly retryAt?: number;

  constructor(kind: GhErrorKind, detail: string, status?: number, retryAt?: number) {
    super(`gh 调用失败：${detail}`);
    this.name = 'GhError';
    this.kind = kind;
    this.detail = detail;
    if (status !== undefined) this.status = status;
    if (retryAt !== undefined) this.retryAt = retryAt;
  }
}

// gh 从 HOME 下的配置与系统 keyring 读取登录态；只透传运行所需的键。
const ENV_KEYS = [
  'HOME', 'PATH', 'LANG', 'LC_ALL', 'TMPDIR',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'no_proxy',
  'GH_CONFIG_DIR', 'XDG_CONFIG_HOME', 'GH_HOST',
] as const;

/** 去掉 DSH/GitHub token 等无关变量，只保留 gh 运行所需的键。 */
export function minimalEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_KEYS) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

const MAX_OUTPUT = 8 * 1024 * 1024;
const RATE_LIMIT = /rate limit|secondary rate|abuse detection/i;
const AUTH = /bad credentials|authentication required|requires authentication|HTTP 401/i;
const FORBIDDEN = /HTTP 403|forbidden|SAML enforcement|not accessible by personal access token/i;
const NOT_FOUND = /HTTP 404|not found/i;
const INVALID = /HTTP 422|validation failed|unprocessable/i;
const NETWORK = /could not resolve host|connection refused|connection reset|network is unreachable|TLS handshake|timeout/i;

/** 把 gh 的非零退出原因归类，供轮询层决定是否退避、是否需要重新登录。 */
export function classifyGhFailure(stderr: string, exitCode: number | null): GhError {
  const detail = stderr.trim().slice(0, 500) || `退出码 ${String(exitCode)}`;
  const statusMatch = /HTTP (\d{3})/.exec(detail);
  const status = statusMatch?.[1] !== undefined ? Number(statusMatch[1]) : undefined;
  if (status === 401 || AUTH.test(detail)) return new GhError('unauthenticated', detail, status ?? 401);
  if (status === 404 || NOT_FOUND.test(detail)) return new GhError('not-found', detail, status ?? 404);
  if (status === 422 || INVALID.test(detail)) return new GhError('invalid', detail, status ?? 422);
  // 限流也可能以 403 返回；先于 forbidden 判断，轮询层才能按限流退避。
  if (status === 429 || RATE_LIMIT.test(detail)) return new GhError('rate-limited', detail, status ?? 429);
  if (status === 403 || FORBIDDEN.test(detail)) return new GhError('forbidden', detail, status ?? 403);
  if (NETWORK.test(detail)) return new GhError('network', detail, status);
  return new GhError('other', detail, status);
}

export function buildEndpoint(endpoint: string, params?: Record<string, string | number | boolean | undefined>): string {
  if (params === undefined) return endpoint;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const query = search.toString();
  if (query === '') return endpoint;
  return `${endpoint}${endpoint.includes('?') ? '&' : '?'}${query}`;
}

/** gh api 的 argv；单独导出便于测试参数边界。 */
export function apiArgs(request: GhRequest): string[] {
  const args = ['api', '--include'];
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    args.push('-H', `${key}: ${value}`);
  }
  args.push(buildEndpoint(request.endpoint, request.params));
  return args;
}

/** 解析 `gh api --include` 的输出：状态行、响应头、空行之后的 body。 */
export function parseGhResponse(stdout: string): GhResponse {
  const normalized = stdout.replace(/\r\n/g, '\n');
  const statusMatch = /^HTTP\/[\d.]+\s+(\d{3})/.exec(normalized);
  if (statusMatch?.[1] === undefined) {
    throw new GhError('invalid-output', stdout.trim().slice(0, 300) || '空响应');
  }
  const split = normalized.indexOf('\n\n');
  const head = split === -1 ? normalized : normalized.slice(0, split);
  const body = split === -1 ? '' : normalized.slice(split + 2);
  const headers: Record<string, string> = {};
  for (const line of head.split('\n').slice(1)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { status: Number(statusMatch[1]), headers, body };
}

/** 判断响应是不是 304；304 时 gh 只打印响应头，没有 body。 */
export function isNotModified(response: GhResponse): boolean {
  return response.status === 304;
}

export function headerNumber(headers: Record<string, string>, name: string): number | undefined {
  const raw = headers[name.toLowerCase()];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function createGhClient(cliPath: string, options: { env?: NodeJS.ProcessEnv; cwd?: string } = {}): GhTransport {
  const env = options.env ?? minimalEnv();
  const exec = createRunner(cliPath, { env, cwd: options.cwd });
  return {
    async api(request, timeoutMs) {
      return parseGhResponse(await exec.run(apiArgs(request), timeoutMs));
    },
    exec: (args, timeoutMs) => exec.run(args, timeoutMs),
  };
}

export interface GhTransport {
  api(request: GhRequest, timeoutMs: number): Promise<GhResponse>;
  /** 执行非 API 命令（如 auth status）；只用于只读探测。 */
  exec(args: string[], timeoutMs: number): Promise<string>;
}

export interface RunnerOptions {
  /** 固定 cwd，避免 gh 读到调用方仓库里的本地配置。 */
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export function createRunner(cliPath: string, options: RunnerOptions = {}): CommandRunner {
  const env = options.env ?? minimalEnv();
  return {
    run: (args, timeoutMs) => new Promise((resolve, reject) => {
      const child = spawn(cliPath, args, {
        cwd: options.cwd,
        env,
        shell: false,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let overflow = false;
      let finished = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (action: () => void): void => {
        if (finished) return;
        finished = true;
        if (timer !== undefined) clearTimeout(timer);
        action();
      };
      const append = (current: string, chunk: Buffer): string => {
        if (current.length >= MAX_OUTPUT) {
          overflow = true;
          return current;
        }
        const next = current + chunk.toString('utf8');
        if (next.length > MAX_OUTPUT) {
          overflow = true;
          return next.slice(0, MAX_OUTPUT);
        }
        return next;
      };
      child.stdout?.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
      child.stderr?.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
      child.once('error', (error: NodeJS.ErrnoException) => {
        finish(() => reject(error.code === 'ENOENT'
          ? new GhError('not-installed', `找不到 ${cliPath}，请先安装 GitHub CLI`)
          : new GhError('other', error.message)));
      });
      child.once('close', (code) => {
        finish(() => {
          // 截断的 JSON 会以 invalid-output 被上层记错，而不是静默返回半截响应。
          if (overflow) {
            reject(new GhError('invalid-output', `gh 输出超过 ${MAX_OUTPUT} 字节`));
            return;
          }
          if (code === 0) {
            resolve(stdout);
            return;
          }
          reject(classifyGhFailure(stderr || stdout, code));
        });
      });
      timer = setTimeout(() => {
        try {
          if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
        child.stdout?.destroy();
        child.stderr?.destroy();
        finish(() => reject(new GhError('timeout', `调用超时（${timeoutMs}ms）`)));
      }, timeoutMs);
    }),
  };
}
