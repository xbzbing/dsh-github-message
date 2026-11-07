// 插件运行时：持有配置、来源句柄、定时器、统计与登录态；面板 RPC 只读写它。
// 调度用 setTimeout 链而不是 setInterval，便于按限流/轮询间隔动态调整下一轮。

import {
  MAX_INTERVAL_MS,
  MIN_INTERVAL_MS,
  normalizeRepo,
  type MentionMode,
  type ResolvedConfig,
} from './config.ts';
import {
  CORE_ISSUE_URL,
  HOST_CONTRACT,
  KINDS,
  PACKAGE_NAME,
  PLUGIN_VERSION,
  PROTOCOL,
  REQUIRED_FEATURE,
  SOURCE_ID,
} from './constants.ts';
import { createGhClient, type GhTransport } from './gh.ts';
import { initialLogin, loginFromPoll, probeLogin, type LoginSnapshot } from './login.ts';
import {
  describeSummary,
  pollConfigOf,
  pollOnce,
  type PollSummary,
  type SourceHandleLike,
} from './poller.ts';
import { readCoreSignals, type CoreSignalStats } from './reminders.ts';
import { loadRuntimeConfig, saveRuntimeConfig } from './runtime-config.ts';
import { emptyStats, loadStats, recordStats, saveStats, type PollStats } from './stats.ts';
import { SeenStore } from './state.ts';

export interface RuntimeLogger {
  debug?(...args: unknown[]): void;
  info?(...args: unknown[]): void;
  warn?(...args: unknown[]): void;
  error?(...args: unknown[]): void;
}

export interface RegisteredSource extends SourceHandleLike {
  readonly id: string;
  dispose(): void;
}

export interface SourceProviderLike {
  id: string;
  protocol: readonly string[];
  kinds: readonly string[];
  trust?: 'external' | 'system';
}

export interface SourceServiceLike {
  protocol?: { versions?: readonly string[]; features?: readonly string[] };
  sources: {
    register(provider: SourceProviderLike): RegisteredSource;
  };
}

export interface RuntimeOptions {
  config: ResolvedConfig;
  logger: RuntimeLogger;
  pollLog?: (event: Record<string, unknown>) => void;
  client?: GhTransport;
  seen?: SeenStore;
  stats?: PollStats;
  now?: () => number;
  reminders?: () => CoreSignalStats;
}

export type SourceState = 'waiting' | 'dry-run' | 'running' | 'paused';

export interface StatusSnapshot {
  contractVersion: number;
  plugin: { name: string; version: string; startedAt: number; dataDir: string };
  source: {
    registered: boolean;
    id: string;
    kinds: string[];
    protocol: string;
    trust: 'external';
    featureSupported: boolean;
    requiredFeature: string;
    coreIssueUrl: string;
    state: SourceState;
  };
  config: {
    intervalMs: number;
    intervalMinutes: number;
    windowMs: number;
    repos: string[];
    maxRepos: number;
    maxResults: number;
    maxPages: number;
    includeDrafts: boolean;
    mentionMode: string;
    effectiveMentionMode: string;
    timeoutMs: number;
    cliPath: string;
  };
  login: LoginSnapshot;
  poll: {
    started: boolean;
    running: boolean;
    nextPollAt?: number;
    lastPollAt?: number;
    lastSummary?: PollSummary;
    backoffMs: number;
  };
  stats: PollStats;
  reminders: CoreSignalStats;
}

export class RuntimeConfigError extends Error {
  readonly code: 'invalid-interval' | 'invalid-repos';

  constructor(code: 'invalid-interval' | 'invalid-repos', message: string) {
    super(message);
    this.name = 'RuntimeConfigError';
    this.code = code;
  }
}

const MAX_BACKOFF_MS = 30 * 60_000;

function failureSummary(at: number, message: string): PollSummary {
  const stream = () => ({
    fetched: 0, emitted: 0, duplicates: 0, filtered: 0, skipped: 0, deferred: 0,
    errors: [] as string[], authenticated: true,
  });
  return {
    at,
    review: stream(),
    issue: stream(),
    mention: stream(),
    fetched: 0,
    emitted: 0,
    duplicates: 0,
    filtered: 0,
    skipped: 0,
    deferred: 0,
    errors: [message],
    authenticated: true,
    sourceDisabled: false,
    mentionNotModified: false,
    mentionComplete: false,
    dryRun: false,
  };
}

export class GithubMessageRuntime {
  private config: ResolvedConfig;
  private readonly logger: RuntimeLogger;
  private readonly pollLog: (event: Record<string, unknown>) => void;
  private readonly client: GhTransport;
  private readonly seen: SeenStore;
  private readonly now: () => number;
  private readonly reminders: () => CoreSignalStats;
  private readonly startedAt: number;

  private stats: PollStats;
  private login: LoginSnapshot = initialLogin();
  private handle: RegisteredSource | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private started = false;
  private running = false;
  private lastSummary: PollSummary | undefined;
  private nextPollAt: number | undefined;
  private featureSupported = false;
  private mentionEtag: string | undefined;
  private consecutiveFailures = 0;
  private attached = false;
  private loginProbed = false;

  constructor(options: RuntimeOptions) {
    this.config = options.config;
    this.logger = options.logger;
    this.pollLog = options.pollLog ?? (() => {});
    this.now = options.now ?? Date.now;
    this.client = options.client ?? createGhClient(this.config.cliPath ?? 'gh', { cwd: this.config.dataDir });
    this.seen = options.seen ?? SeenStore.open({
      file: this.config.stateFile,
      ttlMs: this.config.seenTtlMs,
      maxEntries: this.config.seenMaxEntries,
      now: this.now(),
      logger: this.logger,
    });
    this.stats = options.stats ?? loadStats(this.config.statsFile, this.logger);
    this.reminders = options.reminders ?? (() => readCoreSignals(SOURCE_ID));
    this.startedAt = this.now();
  }

  /** 来源服务出现后注册并开始轮询；重复调用无副作用。 */
  attach(service: SourceServiceLike): void {
    if (this.attached) return;
    this.attached = true;
    const features = service.protocol?.features ?? [];
    this.featureSupported = features.includes(REQUIRED_FEATURE);
    try {
      this.handle = service.sources.register({
        id: SOURCE_ID,
        protocol: [PROTOCOL],
        kinds: [...KINDS],
        trust: 'external',
      });
    } catch (error) {
      this.handle = undefined;
      this.attached = false;
      this.logger.error?.('注册 GitHub 来源失败', error);
      return;
    }
    this.started = true;
    if (!this.featureSupported) {
      this.logger.warn?.(`核心未声明 ${REQUIRED_FEATURE}，只采集候选，不向核心上报`);
    }
    this.schedule();
    if (this.config.onStart) void this.pollNow();
  }

  /** 来源服务消失/插件卸载：撤销注册、停表并落盘。 */
  detach(): void {
    this.started = false;
    this.clearTimer();
    this.seen.save(this.logger);
    saveStats(this.config.statsFile, this.stats, this.logger);
    this.handle?.dispose();
    this.handle = undefined;
    this.attached = false;
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.nextPollAt = undefined;
  }

  private backoffDelay(): number {
    if (this.consecutiveFailures === 0) return this.config.intervalMs;
    const factor = 2 ** Math.min(this.consecutiveFailures - 1, 6);
    return Math.min(MAX_BACKOFF_MS, this.config.intervalMs * factor);
  }

  private schedule(delayMs?: number): void {
    if (!this.started) return;
    this.clearTimer();
    let delay = delayMs ?? this.backoffDelay();
    const summary = this.lastSummary;
    if (summary?.rateLimitResetAt !== undefined) {
      delay = Math.max(delay, summary.rateLimitResetAt - this.now() + 5_000);
    }
    if (summary?.pollIntervalMs !== undefined) {
      delay = Math.max(delay, summary.pollIntervalMs);
    }
    this.nextPollAt = this.now() + delay;
    this.timer = setTimeout(() => void this.pollNow(), delay);
  }

  async pollNow(force = false): Promise<void> {
    if (this.running || !this.started || this.handle === undefined) return;
    // 401 后暂停自动轮询；面板的“立即检查”可以强制再探一次。
    if (!force && this.login.api === 'expired') {
      this.schedule();
      return;
    }
    // 第一轮前先探一次登录：mention 摘要需要当前账号名，面板也能立即显示状态。
    if (!this.loginProbed) {
      this.loginProbed = true;
      this.login = await probeLogin(this.client, this.config.timeoutMs);
      if (!force && this.login.api === 'expired') {
        this.schedule();
        return;
      }
    }

    this.running = true;
    try {
      const summary = await pollOnce({
        client: this.client,
        handle: this.handle,
        config: pollConfigOf({ ...this.config, mentionMode: this.effectiveMentionMode() }, {
          dryRun: !this.featureSupported,
          login: this.login.username,
          ...(this.stats.lastSuccessAt === undefined ? {} : { mentionSinceMs: this.stats.lastSuccessAt }),
          ...(this.mentionEtag === undefined ? {} : { mentionEtag: this.mentionEtag }),
        }),
        seen: this.seen,
        now: this.now,
      });
      this.lastSummary = summary;
      this.stats = recordStats(this.stats, summary);
      this.login = loginFromPoll(this.login, summary);
      if (summary.mentionEtag !== undefined) this.mentionEtag = summary.mentionEtag;
      if (summary.errors.length === 0 && summary.authenticated) this.consecutiveFailures = 0;
      else this.consecutiveFailures += 1;
      this.seen.save(this.logger);
      saveStats(this.config.statsFile, this.stats, this.logger);
      this.logger.info?.(`GitHub 轮询完成：${describeSummary(summary)}`);
      for (const error of summary.errors) this.logger.warn?.(error);
      this.pollLog({ ok: summary.errors.length === 0, ...summary, version: PLUGIN_VERSION });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const summary = failureSummary(this.now(), message);
      this.lastSummary = summary;
      this.stats = recordStats(this.stats, summary);
      this.consecutiveFailures += 1;
      saveStats(this.config.statsFile, this.stats, this.logger);
      this.logger.error?.('GitHub 轮询异常', error);
      this.pollLog({ ok: false, error: message, version: PLUGIN_VERSION });
    } finally {
      this.running = false;
      this.schedule();
    }
  }

  /** 面板保存周期与仓库列表；持久化并立即重排定时器。 */
  setConfig(payload: unknown): StatusSnapshot {
    const input = payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {};

    let intervalMs = this.config.intervalMs;
    if (input.intervalMs !== undefined) {
      const number = typeof input.intervalMs === 'number' ? input.intervalMs : Number(input.intervalMs);
      if (!Number.isFinite(number) || number <= 0) {
        throw new RuntimeConfigError('invalid-interval', '检查周期必须是大于 0 的毫秒数');
      }
      intervalMs = Math.trunc(Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, number)));
    }

    let repos = this.config.repos;
    if (input.repos !== undefined) {
      if (!Array.isArray(input.repos)) throw new RuntimeConfigError('invalid-repos', '仓库列表必须是数组');
      const seen = new Set<string>();
      const parsed: string[] = [];
      for (const item of input.repos) {
        const repo = normalizeRepo(item);
        if (repo === undefined) throw new RuntimeConfigError('invalid-repos', `${JSON.stringify(item)} 不是合法的 owner/repo`);
        if (seen.has(repo.toLowerCase())) continue;
        seen.add(repo.toLowerCase());
        parsed.push(repo);
      }
      repos = parsed.slice(0, this.config.maxRepos);
      if (parsed.length > this.config.maxRepos) {
        this.logger.warn?.(`仓库列表有 ${parsed.length} 个，超过上限 ${this.config.maxRepos}，只保留前 ${this.config.maxRepos} 个`);
      }
    }

    const changedInterval = intervalMs !== this.config.intervalMs;
    this.config = { ...this.config, intervalMs, repos: [...repos] };
    // 只持久化用户这次真正改过的字段，避免保存周期时把 patch 里的仓库列表一起钉死。
    const update: { intervalMs?: number; repos?: string[] } = {};
    if (input.intervalMs !== undefined) update.intervalMs = intervalMs;
    if (input.repos !== undefined) update.repos = [...repos];
    if (update.intervalMs !== undefined || update.repos !== undefined) {
      const existing = loadRuntimeConfig(this.config.runtimeConfigFile, this.logger);
      saveRuntimeConfig(this.config.runtimeConfigFile, { ...existing, ...update }, this.logger);
    }
    if (this.started && changedInterval) this.schedule();
    return this.status();
  }

  /** 面板“检查登录”：本地登录态 + 一次只读 API 探测。 */
  async checkLogin(): Promise<LoginSnapshot> {
    this.login = await probeLogin(this.client, this.config.timeoutMs);
    if (this.login.api === 'ok') {
      this.consecutiveFailures = 0;
      if (this.started) this.schedule();
    }
    return this.login;
  }

  resetStats(): void {
    this.stats = emptyStats();
    this.lastSummary = undefined;
    saveStats(this.config.statsFile, this.stats, this.logger);
  }

  /** 缺少 notifications scope 时自动降级为 search，避免每轮都 403。 */
  private effectiveMentionMode(): MentionMode {
    return this.config.mentionMode === 'notifications' && this.login.notifications === 'missing'
      ? 'search'
      : this.config.mentionMode;
  }

  private sourceState(): SourceState {
    if (this.handle === undefined) return 'waiting';
    if (!this.featureSupported) return 'dry-run';
    if (this.login.api === 'expired') return 'paused';
    if (this.lastSummary?.sourceDisabled === true) return 'waiting';
    return 'running';
  }

  status(): StatusSnapshot {
    return {
      contractVersion: HOST_CONTRACT,
      plugin: {
        name: PACKAGE_NAME,
        version: PLUGIN_VERSION,
        startedAt: this.startedAt,
        dataDir: this.config.dataDir,
      },
      source: {
        registered: this.handle !== undefined,
        id: SOURCE_ID,
        kinds: [...KINDS],
        protocol: PROTOCOL,
        trust: 'external',
        featureSupported: this.featureSupported,
        requiredFeature: REQUIRED_FEATURE,
        coreIssueUrl: CORE_ISSUE_URL,
        state: this.sourceState(),
      },
      config: {
        intervalMs: this.config.intervalMs,
        intervalMinutes: this.config.intervalMs / 60_000,
        windowMs: this.config.windowMs,
        repos: [...this.config.repos],
        maxRepos: this.config.maxRepos,
        maxResults: this.config.maxResults,
        maxPages: this.config.maxPages,
        includeDrafts: this.config.includeDrafts,
        mentionMode: this.config.mentionMode,
        effectiveMentionMode: this.effectiveMentionMode(),
        timeoutMs: this.config.timeoutMs,
        cliPath: this.config.cliPath ?? 'gh',
      },
      login: this.login,
      poll: {
        started: this.started,
        running: this.running,
        ...(this.nextPollAt === undefined ? {} : { nextPollAt: this.nextPollAt }),
        ...(this.stats.lastPollAt === undefined ? {} : { lastPollAt: this.stats.lastPollAt }),
        ...(this.lastSummary === undefined ? {} : { lastSummary: this.lastSummary }),
        backoffMs: this.consecutiveFailures === 0 ? 0 : this.backoffDelay(),
      },
      stats: this.stats,
      reminders: this.reminders(),
    };
  }
}
