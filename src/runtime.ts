// 插件运行时：持有配置、来源句柄、定时器、统计与登录态；面板 RPC 只读写它。
// 调度用 setTimeout 链而不是 setInterval，便于按限流/轮询间隔动态调整下一轮。

import {
  ISSUE_SCOPES,
  MAX_INTERVAL_MS,
  MIN_INTERVAL_MS,
  PR_SCOPES,
  normalizeOrg,
  normalizeRepo,
  type IssueScope,
  type MentionMode,
  type PrScope,
  type ResolvedConfig,
} from './config.ts';
import {
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
import { MAX_NOTICE_BATCH, MAX_NOTICES, noticeOf, type NoticeFeed, type NoticeItem } from './notices.ts';
import {
  describeSummary,
  pollConfigOf,
  pollOnce,
  type PollSummary,
  type SourceHandleLike,
} from './poller.ts';
import { readCoreSignals, type CoreSignalStats } from './reminders.ts';
import { loadRuntimeConfig, saveRuntimeConfig } from './runtime-config.ts';
import type { SignalDraft } from './signals.ts';
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
  notified?: SeenStore;
  stats?: PollStats;
  now?: () => number;
  reminders?: () => CoreSignalStats;
}

export type SourceState = 'waiting' | 'standalone' | 'dry-run' | 'running' | 'paused';

export interface StatusSnapshot {
  contractVersion: number;
  plugin: { name: string; version: string; startedAt: number; dataDir: string };
  source: {
    registered: boolean;
    /** 完全没有 mySuperagent 服务：独立采集，用本地提示代替上报。 */
    standalone: boolean;
    id: string;
    kinds: string[];
    protocol: string;
    trust: 'external';
    featureSupported: boolean;
    requiredFeature: string;
    state: SourceState;
  };
  config: {
    intervalMs: number;
    intervalMinutes: number;
    windowMs: number;
    repos: string[];
    issueScope: IssueScope;
    prScope: PrScope;
    orgs: string[];
    maxRepos: number;
    maxOrgs: number;
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
  notices: { enabled: boolean; count: number; lastAt?: number };
}

export class RuntimeConfigError extends Error {
  readonly code: 'invalid-interval' | 'invalid-repos' | 'invalid-orgs' | 'invalid-issue-scope' | 'invalid-pr-scope';

  constructor(code: 'invalid-interval' | 'invalid-repos' | 'invalid-orgs' | 'invalid-issue-scope' | 'invalid-pr-scope', message: string) {
    super(message);
    this.name = 'RuntimeConfigError';
    this.code = code;
  }
}

const MAX_BACKOFF_MS = 30 * 60_000;

/**
 * 没有 mySuperagent 时的首轮宽限：等同步加载的其他插件把服务注册上来，
 * 避免“其实已接入，却先按独立模式弹了一条提示”。
 */
const STANDALONE_GRACE_MS = 3_000;

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
    selfPr: stream(),
    repoPr: stream(),
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
  private readonly notified: SeenStore;
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
  /** GitHub Notifications 返回的最小轮询间隔；失败时也要继续遵守。 */
  private githubPollIntervalMs: number | undefined;
  private featureSupported = false;
  private mentionEtag: string | undefined;
  private consecutiveFailures = 0;
  private attached = false;
  private loginProbed = false;
  private remindersCache: { at: number; value: CoreSignalStats } | undefined;
  private noticeSeq = 0;
  private noticeCount = 0;
  private noticeAt: number | undefined;
  private readonly noticeItems: NoticeItem[] = [];

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
    this.notified = options.notified ?? SeenStore.open({
      file: this.config.notifiedFile,
      ttlMs: this.config.seenTtlMs,
      maxEntries: this.config.seenMaxEntries,
      now: this.now(),
      logger: this.logger,
    });
    this.stats = options.stats ?? loadStats(this.config.statsFile, this.logger);
    this.reminders = options.reminders ?? (() => readCoreSignals(SOURCE_ID));
    this.startedAt = this.now();
  }

  /**
   * 开始轮询。没接入核心时也照常跑，只是把结果留在本地提示里。
   * 首轮留一段宽限，等同批加载的其他插件把 mySuperagent 注册上来。
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.config.onStart) {
      this.schedule(this.handle === undefined ? STANDALONE_GRACE_MS : 0);
    } else {
      this.schedule();
    }
  }

  /** 来源服务出现后注册；重复调用无副作用。 */
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
      this.featureSupported = false;
      this.logger.error?.('注册 GitHub 来源失败', error);
      return;
    }
    if (!this.featureSupported) {
      this.logger.warn?.(`核心未声明 ${REQUIRED_FEATURE}，只采集候选，不向核心上报`);
    }
    if (!this.started) {
      this.start();
      return;
    }
    // 接入核心后立刻跑首轮，别让宽限期白等。
    if (this.config.onStart) this.schedule(0);
  }

  /** 核心服务消失：撤销注册，但继续独立轮询（改走本地提示）。 */
  detachSource(): void {
    this.handle?.dispose();
    this.handle = undefined;
    this.attached = false;
    this.featureSupported = false;
  }

  /** 插件卸载：停表、撤销注册并落盘。 */
  detach(): void {
    this.started = false;
    this.clearTimer();
    this.seen.save(this.logger);
    this.notified.save(this.logger);
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
    if (this.githubPollIntervalMs !== undefined) {
      delay = Math.max(delay, this.githubPollIntervalMs);
    }
    this.nextPollAt = this.now() + delay;
    this.timer = setTimeout(() => void this.pollNow(), delay);
  }

  async pollNow(force = false): Promise<void> {
    if (this.running || !this.started) return;
    // 先占住 running 再探测登录，避免 attach 的首轮与面板“立即检查”并发。
    this.running = true;
    try {
      // 首次、或上次不可用时重新探测；这样终端里重新 gh auth login 后能自动恢复。
      if (!this.loginProbed || this.login.api !== 'ok') {
        this.loginProbed = true;
        this.login = await probeLogin(this.client, this.config.timeoutMs);
        if (!this.started) return;
      }
      // 401 后暂停自动轮询；面板的“立即检查”可以强制再探一次。
      if (!force && this.login.api === 'expired') return;
      const dryRun = this.handle === undefined || !this.featureSupported;
      const summary = await pollOnce({
        client: this.client,
        handle: this.handle,
        config: pollConfigOf({ ...this.config, mentionMode: this.effectiveMentionMode() }, {
          dryRun,
          login: this.login.username,
          // 只有上一轮真正把 mention 处理完（不是 dryRun、来源关闭或出错）才推进游标/ETag；
          // 否则用完整时间窗重扫，避免开启来源后漏掉旧 @。
          ...(this.mentionSettled() && this.stats.lastSuccessAt !== undefined
            ? { mentionSinceMs: this.stats.lastSuccessAt }
            : {}),
          ...(this.mentionSettled() && this.mentionEtag !== undefined ? { mentionEtag: this.mentionEtag } : {}),
        }),
        seen: this.seen,
        now: this.now,
        isActive: () => this.started,
        onUndelivered: (draft) => this.pushNotice(draft),
      });
      // 插件卸载后在途轮询不再写 seen/统计，避免把已撤销的状态落盘。
      if (!this.started) return;
      this.lastSummary = summary;
      if (summary.pollIntervalMs !== undefined) this.githubPollIntervalMs = summary.pollIntervalMs;
      this.stats = recordStats(this.stats, summary);
      this.login = loginFromPoll(this.login, summary);
      if (this.mentionSettled() && summary.mentionEtag !== undefined) this.mentionEtag = summary.mentionEtag;
      if (!this.mentionSettled()) this.mentionEtag = undefined;
      if (summary.errors.length === 0 && summary.authenticated) this.consecutiveFailures = 0;
      else this.consecutiveFailures += 1;
      this.seen.save(this.logger);
      this.notified.save(this.logger);
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

  /** 面板保存周期、仓库、Issue/PR 范围与组织；持久化，周期变化时重排定时器。 */
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

    let issueScope = this.config.issueScope;
    if (input.issueScope !== undefined) {
      const scope = typeof input.issueScope === 'string'
        ? ISSUE_SCOPES.find((candidate) => candidate === input.issueScope)
        : undefined;
      if (scope === undefined) throw new RuntimeConfigError('invalid-issue-scope', 'Issue 范围必须是 repos 或 owned');
      issueScope = scope;
    }

    let prScope = this.config.prScope;
    if (input.prScope !== undefined) {
      const scope = typeof input.prScope === 'string'
        ? PR_SCOPES.find((candidate) => candidate === input.prScope)
        : undefined;
      if (scope === undefined) throw new RuntimeConfigError('invalid-pr-scope', 'PR 范围必须是 review 或 owned');
      prScope = scope;
    }

    let orgs = this.config.orgs;
    if (input.orgs !== undefined) {
      if (!Array.isArray(input.orgs)) throw new RuntimeConfigError('invalid-orgs', '组织列表必须是数组');
      const seen = new Set<string>();
      const parsed: string[] = [];
      for (const item of input.orgs) {
        const org = normalizeOrg(item);
        if (org === undefined) throw new RuntimeConfigError('invalid-orgs', `${JSON.stringify(item)} 不是合法的组织名`);
        if (seen.has(org.toLowerCase())) continue;
        seen.add(org.toLowerCase());
        parsed.push(org);
      }
      orgs = parsed.slice(0, this.config.maxOrgs);
      if (parsed.length > this.config.maxOrgs) {
        this.logger.warn?.(`组织列表有 ${parsed.length} 个，超过上限 ${this.config.maxOrgs}，只保留前 ${this.config.maxOrgs} 个`);
      }
    }

    const changedInterval = intervalMs !== this.config.intervalMs;
    this.config = { ...this.config, intervalMs, repos: [...repos], issueScope, prScope, orgs: [...orgs] };
    // 只持久化用户这次真正改过的字段，避免保存周期时把 patch 里的仓库列表一起钉死。
    const update: { intervalMs?: number; repos?: string[]; issueScope?: IssueScope; prScope?: PrScope; orgs?: string[] } = {};
    if (input.intervalMs !== undefined) update.intervalMs = intervalMs;
    if (input.repos !== undefined) update.repos = [...repos];
    if (input.issueScope !== undefined) update.issueScope = issueScope;
    if (input.prScope !== undefined) update.prScope = prScope;
    if (input.orgs !== undefined) update.orgs = [...orgs];
    if (Object.keys(update).length > 0) {
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

  /**
   * 记一条本地提示。同一事实只提示一次（notified 独立于 seen），
   * 接入核心后仍会重新上报，由核心决定要不要通知。
   */
  private pushNotice(draft: SignalDraft): void {
    const now = this.now();
    if (this.notified.has(draft.sourceEventId, now)) return;
    this.notified.add(draft.sourceEventId, now);
    this.noticeSeq += 1;
    this.noticeCount += 1;
    this.noticeAt = now;
    this.noticeItems.push(noticeOf(draft, this.noticeSeq));
    if (this.noticeItems.length > MAX_NOTICES) {
      this.noticeItems.splice(0, this.noticeItems.length - MAX_NOTICES);
    }
  }

  /**
   * 客户端取本地提示。不传 since 只回游标，避免打开页面时把历史积压一次性弹出来。
   */
  notices(since?: unknown): NoticeFeed {
    const enabled = this.started && (this.handle === undefined || !this.featureSupported);
    const seq = this.noticeSeq;
    if (!enabled) return { enabled: false, seq, items: [] };
    const cursor = typeof since === 'number' && Number.isFinite(since) ? since : undefined;
    if (cursor === undefined) return { enabled: true, seq, initialized: true, items: [] };
    const items = this.noticeItems.filter((item) => item.seq > cursor).slice(-MAX_NOTICE_BATCH);
    return { enabled: true, seq, items };
  }

  /** 上一轮是否把 mention 完整处理完；dryRun/来源关闭/出错时不能推进 cursor。 */
  private mentionSettled(): boolean {
    const summary = this.lastSummary;
    return summary !== undefined
      && !summary.dryRun
      && !summary.sourceDisabled
      && summary.mentionComplete
      && summary.mention.authenticated
      && summary.mention.errors.length === 0;
  }

  /** 面板每 10 秒刷新一次，SQLite 统计缓存 5 秒，避免反复同步打开数据库。 */
  private remindersSnapshot(): CoreSignalStats {
    const now = this.now();
    if (this.remindersCache !== undefined && now - this.remindersCache.at < 5_000) {
      return this.remindersCache.value;
    }
    const value = this.reminders();
    this.remindersCache = { at: now, value };
    return value;
  }

  /** 缺少 notifications scope 时自动降级为 search，避免每轮都 403。 */
  private effectiveMentionMode(): MentionMode {
    return this.config.mentionMode === 'notifications' && this.login.notifications === 'missing'
      ? 'search'
      : this.config.mentionMode;
  }

  private sourceState(): SourceState {
    if (!this.started) return 'waiting';
    if (this.handle === undefined) return 'standalone';
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
        standalone: this.handle === undefined,
        id: SOURCE_ID,
        kinds: [...KINDS],
        protocol: PROTOCOL,
        trust: 'external',
        featureSupported: this.featureSupported,
        requiredFeature: REQUIRED_FEATURE,
        state: this.sourceState(),
      },
      config: {
        intervalMs: this.config.intervalMs,
        intervalMinutes: this.config.intervalMs / 60_000,
        windowMs: this.config.windowMs,
        repos: [...this.config.repos],
        issueScope: this.config.issueScope,
        prScope: this.config.prScope,
        orgs: [...this.config.orgs],
        maxRepos: this.config.maxRepos,
        maxOrgs: this.config.maxOrgs,
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
      reminders: this.remindersSnapshot(),
      notices: {
        enabled: this.handle === undefined || !this.featureSupported,
        count: this.noticeCount,
        ...(this.noticeAt === undefined ? {} : { lastAt: this.noticeAt }),
      },
    };
  }
}
