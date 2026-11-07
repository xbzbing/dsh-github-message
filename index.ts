// dsh-github-message：只读轮询 GitHub，把待评审 PR、新 Issue 与 @ 提醒翻译成
// my-superagent/v1 信号。host 半同时给 client 面板提供状态/配置/登录/统计 RPC。

import { appendFileSync, chmodSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { dataDirectory, resolveConfig } from './src/config.ts';
import { PACKAGE_NAME, PLUGIN_VERSION } from './src/constants.ts';
import { createRpcRoute } from './src/rpc.ts';
import { loadRuntimeConfig } from './src/runtime-config.ts';
import { GithubMessageRuntime, type RuntimeLogger, type SourceServiceLike } from './src/runtime.ts';

export const name = PACKAGE_NAME;
export const version = PLUGIN_VERSION;
export const inject: string[] = [];

interface ConnectionLike {
  fetch?: {
    register(route: unknown): unknown;
  };
}

interface Scope {
  logger?: RuntimeLogger | ((scope: string) => RuntimeLogger | undefined);
  mySuperagent?: SourceServiceLike;
  connection?: ConnectionLike;
  inject?(dependencies: string[], callback: (scope: Scope) => void): unknown;
  effect?(execute: () => (() => void) | void, label?: string): unknown;
}

const LOG_LIMIT = 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resolveLogger(ctx: Scope): RuntimeLogger {
  const logger = ctx.logger;
  if (typeof logger === 'function') return logger(name) ?? console;
  if (logger !== undefined && logger !== null) return logger;
  return console;
}

/** 轮询摘要写到插件数据目录，便于面板看不到日志时排查；写失败不影响轮询。 */
function createPollLog(path: string | undefined, log: RuntimeLogger): (event: Record<string, unknown>) => void {
  if (path === undefined) return () => {};
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    try { chmodSync(path, 0o600); } catch { /* 文件还不存在；首次创建时用 mode 600 */ }
  } catch (error) {
    log.warn?.('创建日志目录失败', error);
    return () => {};
  }
  return (event) => {
    try {
      const current = statSync(path, { throwIfNoEntry: false });
      if (current !== undefined && current.size > LOG_LIMIT) writeFileSync(path, '', { mode: 0o600 });
      appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, { encoding: 'utf8', mode: 0o600 });
    } catch {
      // 日志不是功能路径，失败就静默。
    }
  };
}

export function apply(ctx: Scope, rawConfig: unknown = {}): void {
  const warnings: string[] = [];
  const log = resolveLogger(ctx);
  const raw = isRecord(rawConfig) ? rawConfig : {};
  const env = { env: process.env, home: homedir() };

  // 面板保存的运行时配置优先于 Cordis patch，但只覆盖它声明的字段。
  const dataDir = dataDirectory(raw, env);
  const configuredPath = raw.runtimeConfigFile;
  const runtimeConfigPath = configuredPath === false
    ? undefined
    : typeof configuredPath === 'string' && configuredPath !== ''
      ? configuredPath
      : join(dataDir, 'config.json');
  const persisted = loadRuntimeConfig(runtimeConfigPath, log);
  const config = resolveConfig({ ...raw, ...persisted }, env, warnings);

  for (const warning of warnings) log.warn?.(warning);

  try {
    mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  } catch (error) {
    log.warn?.('创建插件数据目录失败，GitHub 轮询可能无法保存状态', error);
  }

  const runtime = new GithubMessageRuntime({
    config,
    logger: log,
    pollLog: createPollLog(config.logFile, log),
  });

  // 来源服务出现后注册并开始轮询；服务消失时 scope.effect 撤销注册。
  ctx.inject?.(['mySuperagent'], (scope) => {
    const service = scope.mySuperagent;
    if (!service) return;
    try {
      runtime.attach(service);
    } catch (error) {
      log.error?.('注册 GitHub 来源失败', error);
      return;
    }
    scope.effect?.(() => () => runtime.detach(), 'dsh-github-message: 轮询与来源');
  });

  // 面板 RPC：即使 mySuperagent 缺席也注册，用户仍能看登录/配置/统计。
  ctx.inject?.(['connection'], (scope) => {
    const fetch = scope.connection?.fetch;
    const register = fetch?.register;
    if (fetch === undefined || typeof register !== 'function') return;
    const route = createRpcRoute(runtime, (method, error) => {
      log.warn?.(`面板操作失败 ${method}`, error);
    });
    scope.effect?.(() => {
      const dispose = register.call(fetch, route);
      return typeof dispose === 'function' ? dispose as () => void : undefined;
    }, 'dsh-github-message: 面板 RPC');
  });
}
