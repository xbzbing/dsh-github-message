// 插件的配置解析：把 Cordis 传进来的原始对象收敛成一份带默认值、有上下限的配置。
// 配置错误只降级并记 warning，不让插件整个起不来。

import { join } from 'node:path';

export const MENTION_MODES = ['notifications', 'search', 'off'] as const;
export type MentionMode = (typeof MENTION_MODES)[number];

export const DEFAULT_INTERVAL_MS = 5 * 60_000; // 5 分钟
export const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60_000; // 7 天
export const MIN_INTERVAL_MS = 60_000;
// Node 的 setTimeout 对超过 2^31-1 的延迟会退化为 1ms；这里取 24 小时作为产品上限。
export const MAX_INTERVAL_MS = 24 * 60 * 60_000;
export const DEFAULT_MAX_REPOS = 10;
export const MAX_REPOS_LIMIT = 10;
export const DEFAULT_MAX_RESULTS = 100;
export const DEFAULT_MAX_PAGES = 3;
export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_SEEN_TTL_MS = 90 * 24 * 60 * 60_000; // 90 天
export const DEFAULT_SEEN_MAX_ENTRIES = 20_000;

/** GitHub 的 owner/repo 允许字母、数字、下划线、点、连字符。 */
export const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export interface ResolvedConfig {
  /** 两次轮询之间的间隔。默认 5 分钟。 */
  intervalMs: number;
  /** review/issue/mention 的时间窗；0 表示不过滤。 */
  windowMs: number;
  /** 维护中的仓库列表（owner/repo），issue 流的主体。 */
  repos: string[];
  /** 单轮最多查多少个仓库。 */
  maxRepos: number;
  /** 单个流单轮最多处理多少条。 */
  maxResults: number;
  /** 每个搜索最多翻几页。 */
  maxPages: number;
  /** 是否提醒 draft PR。 */
  includeDrafts: boolean;
  /** @ 提醒的获取方式。 */
  mentionMode: MentionMode;
  /** 单次 gh 调用的超时。 */
  timeoutMs: number;
  /** gh 可执行文件；不填时按 DSH_GITHUB_CLI、PATH 顺序探测。 */
  cliPath?: string;
  /** 插件加载后是否立即轮询一次。 */
  onStart: boolean;
  /** 去重状态文件；false 表示只在内存里去重。 */
  stateFile?: string;
  /** 本地提示记录；与去重分开，避免提示过的事实被当成已上报。false 表示只在内存里记。 */
  notifiedFile?: string;
  /** 去重记录的保留期。 */
  seenTtlMs: number;
  /** 去重记录的最大条数。 */
  seenMaxEntries: number;
  /** 轮询摘要日志；false 表示不写。 */
  logFile?: string;
  /** 轮询统计；false 表示只在内存里累计。 */
  statsFile?: string;
  /** 面板修改的运行时配置（周期、仓库）；false 表示不持久化。 */
  runtimeConfigFile?: string;
  /** 插件自己的数据目录。 */
  dataDir: string;
}

export interface ResolveEnv {
  env: Record<string, string | undefined>;
  home: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function positive(value: unknown): number | undefined {
  const number = finite(value);
  return number !== undefined && number > 0 ? number : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** 规范化仓库名：去空白、去末尾斜杠；不合法返回 undefined。展示保留原大小写。 */
export function normalizeRepo(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\/+$/, '');
  return REPO_PATTERN.test(trimmed) ? trimmed : undefined;
}

/** 仓库列表：逐项校验、大小写不敏感去重；非法项写 warning。 */
export function parseRepos(value: unknown, warnings: string[] = []): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    warnings.push('repos 必须是 owner/repo 字符串数组，已忽略');
    return [];
  }
  const seen = new Set<string>();
  const repos: string[] = [];
  for (const item of value) {
    const repo = normalizeRepo(item);
    if (repo === undefined) {
      warnings.push(`repos 里的 ${JSON.stringify(item)} 不是合法的 owner/repo，已忽略`);
      continue;
    }
    const key = repo.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    repos.push(repo);
  }
  return repos;
}

export function dataDirectory(raw: Record<string, unknown>, env: ResolveEnv): string {
  const configured = text(raw.dataDir);
  if (configured !== undefined) return configured;
  const home = text(env.env.DSH_HOME) ?? join(env.home, '.dsh');
  return join(home, 'dsh-github-message');
}

/**
 * 解析配置。warnings 里是降级原因，调用方负责写日志。
 */
export function resolveConfig(raw: unknown, env: ResolveEnv, warnings: string[] = []): ResolvedConfig {
  const input = isRecord(raw) ? raw : {};

  let intervalMs = positive(input.intervalMs);
  if (intervalMs === undefined) {
    const minutes = positive(input.intervalMinutes);
    if (minutes !== undefined) intervalMs = minutes * 60_000;
  }
  if (intervalMs === undefined) intervalMs = DEFAULT_INTERVAL_MS;
  const beforeClamp = intervalMs;
  intervalMs = clamp(intervalMs, MIN_INTERVAL_MS, MAX_INTERVAL_MS);
  if (intervalMs !== beforeClamp) {
    warnings.push(beforeClamp < MIN_INTERVAL_MS
      ? `intervalMs=${beforeClamp} 太小，已提升到 ${MIN_INTERVAL_MS}ms；轮询过密会消耗 GitHub API 配额`
      : `intervalMs=${beforeClamp} 太大，已压到 ${MAX_INTERVAL_MS}ms；更长的延迟请用调度器而不是 setTimeout`);
  }

  let windowMs = finite(input.windowMs) ?? DEFAULT_WINDOW_MS;
  if (windowMs < 0) {
    warnings.push(`windowMs=${windowMs} 非法，已改用默认值 ${DEFAULT_WINDOW_MS}ms`);
    windowMs = DEFAULT_WINDOW_MS;
  }

  const maxRepos = Math.trunc(clamp(finite(input.maxRepos) ?? DEFAULT_MAX_REPOS, 1, MAX_REPOS_LIMIT));
  let repos = parseRepos(input.repos, warnings);
  if (repos.length > maxRepos) {
    warnings.push(`repos 有 ${repos.length} 个，超过 maxRepos=${maxRepos}，只保留前 ${maxRepos} 个`);
    repos = repos.slice(0, maxRepos);
  }

  const maxResults = Math.trunc(clamp(finite(input.maxResults) ?? DEFAULT_MAX_RESULTS, 1, 100));
  const maxPages = Math.trunc(clamp(finite(input.maxPages) ?? DEFAULT_MAX_PAGES, 1, 10));
  const timeoutMs = Math.trunc(clamp(positive(input.timeoutMs) ?? DEFAULT_TIMEOUT_MS, 1_000, 120_000));
  const seenTtlMs = Math.trunc(clamp(
    positive(input.seenTtlMs) ?? DEFAULT_SEEN_TTL_MS,
    Math.max(intervalMs, 60_000),
    365 * 24 * 60 * 60_000,
  ));
  const seenMaxEntries = Math.trunc(clamp(finite(input.seenMaxEntries) ?? DEFAULT_SEEN_MAX_ENTRIES, 100, 200_000));

  let mentionMode: MentionMode = 'notifications';
  if (typeof input.mentionMode === 'string') {
    const candidate = MENTION_MODES.find((mode) => mode === input.mentionMode);
    if (candidate !== undefined) mentionMode = candidate;
    else warnings.push(`mentionMode=${JSON.stringify(input.mentionMode)} 不合法，已改用 notifications`);
  }

  const dataDir = dataDirectory(input, env);
  const stateFile = input.stateFile === false
    ? undefined
    : text(input.stateFile) ?? join(dataDir, 'seen.json');
  const notifiedFile = input.notifiedFile === false
    ? undefined
    : text(input.notifiedFile) ?? join(dataDir, 'notified.json');
  const logFile = input.logFile === false
    ? undefined
    : text(input.logFile) ?? join(dataDir, 'poll.log');
  const statsFile = input.statsFile === false
    ? undefined
    : text(input.statsFile) ?? join(dataDir, 'stats.json');
  const runtimeConfigFile = input.runtimeConfigFile === false
    ? undefined
    : text(input.runtimeConfigFile) ?? join(dataDir, 'config.json');

  return {
    intervalMs,
    windowMs,
    repos,
    maxRepos,
    maxResults,
    maxPages,
    includeDrafts: input.includeDrafts !== false,
    mentionMode,
    timeoutMs,
    cliPath: text(input.cliPath) ?? text(env.env.DSH_GITHUB_CLI),
    onStart: input.onStart !== false,
    stateFile,
    notifiedFile,
    seenTtlMs,
    seenMaxEntries,
    logFile,
    statsFile,
    runtimeConfigFile,
    dataDir,
  };
}
