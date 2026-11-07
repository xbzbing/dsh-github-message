// 轮询编排：三路各自独立拉取、过滤、翻译、上报；一个流失败不影响另外两个。
// 去重分两层：本轮内 Set；跨轮询用 SeenLike（默认持久化到 seen.json）。

import type { MentionMode } from './config.ts';
import type { GhTransport } from './gh.ts';
import {
  fetchMentionCandidates,
  fetchMentionSearch,
  type MentionResult,
} from './notifications.ts';
import {
  fetchIssueCandidates,
  fetchReviewCandidates,
  type IssueCandidate,
  type PullCache,
  type ReviewCandidate,
  type StreamResult,
} from './search.ts';
import {
  issueDraft,
  mentionDraft,
  reviewDraft,
  type SignalDraft,
} from './signals.ts';
import type { SeenLike } from './state.ts';

export { KIND_ISSUE, KIND_MENTION, KIND_REVIEW, KINDS, PROTOCOL, SOURCE_ID } from './constants.ts';

export interface EmitResultLike {
  accepted: boolean;
  id?: string;
  duplicate?: boolean;
  reason?: string;
}

export interface SourceHandleLike {
  emit(draft: SignalDraft): Promise<EmitResultLike>;
}

export interface PollLogger {
  debug?(...args: unknown[]): void;
  info?(...args: unknown[]): void;
  warn?(...args: unknown[]): void;
  error?(...args: unknown[]): void;
}

export interface PollConfig {
  windowMs: number;
  repos: string[];
  maxRepos: number;
  maxResults: number;
  maxPages: number;
  includeDrafts: boolean;
  mentionMode: MentionMode;
  timeoutMs: number;
  login?: string;
  /** 核心未声明 github-source：只采集、不 emit、不写 seen。 */
  dryRun: boolean;
  /** @ 提醒的 since；缺省时按 windowMs 计算。 */
  mentionSinceMs?: number;
  /** Notifications 的 ETag 缓存。 */
  mentionEtag?: string;
}

export interface PollDeps {
  client: GhTransport;
  handle?: SourceHandleLike;
  config: PollConfig;
  seen: SeenLike;
  now?: () => number;
  cache?: PullCache;
}

export interface StreamSummary {
  fetched: number;
  emitted: number;
  duplicates: number;
  filtered: number;
  skipped: number;
  deferred: number;
  errors: string[];
  authenticated: boolean;
}

export interface PollSummary {
  at: number;
  review: StreamSummary;
  issue: StreamSummary;
  mention: StreamSummary;
  fetched: number;
  emitted: number;
  duplicates: number;
  filtered: number;
  skipped: number;
  deferred: number;
  errors: string[];
  authenticated: boolean;
  sourceDisabled: boolean;
  rateLimitResetAt?: number;
  pollIntervalMs?: number;
  mentionEtag?: string;
  mentionNotModified: boolean;
  mentionComplete: boolean;
  dryRun: boolean;
}

const MAX_ERRORS = 20;
const MENTION_OVERLAP_MS = 10 * 60_000;

function emptyStream(): StreamSummary {
  return {
    fetched: 0,
    emitted: 0,
    duplicates: 0,
    filtered: 0,
    skipped: 0,
    deferred: 0,
    errors: [],
    authenticated: true,
  };
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}

function addError(stream: StreamSummary, message: string): void {
  if (stream.errors.length < MAX_ERRORS) stream.errors.push(message);
}

async function processCandidates<T>(
  stream: StreamSummary,
  candidates: T[],
  toDraft: (candidate: T) => SignalDraft,
  deps: PollDeps,
  seenThisPoll: Set<string>,
  now: number,
  flags: { sourceDisabled: boolean },
): Promise<void> {
  for (const candidate of candidates) {
    const draft = toDraft(candidate);
    const id = draft.sourceEventId;
    if (seenThisPoll.has(id) || deps.seen.has(id, now)) {
      stream.duplicates += 1;
      continue;
    }
    if (deps.config.dryRun || deps.handle === undefined) {
      stream.deferred += 1;
      continue;
    }
    let result: EmitResultLike;
    try {
      result = await deps.handle.emit(draft);
    } catch (error) {
      addError(stream, `上报 ${id} 失败：${errorText(error)}`);
      continue;
    }
    if (!result.accepted) {
      if (result.reason === 'source-disabled') {
        flags.sourceDisabled = true;
        stream.deferred += 1;
      } else {
        addError(stream, `上报 ${id} 被拒：${result.reason ?? '未知原因'}`);
      }
      continue;
    }
    // 只有被核心接受（含 duplicate）才写 seen；被拒的下一轮还会重试。
    deps.seen.add(id, now);
    seenThisPoll.add(id);
    if (result.duplicate === true) stream.duplicates += 1;
    else stream.emitted += 1;
  }
}

function applyStreamMeta(stream: StreamSummary, source: StreamResult<unknown>): void {
  stream.fetched = source.fetched;
  stream.filtered = source.filtered;
  stream.skipped = source.skipped;
  stream.authenticated = source.authenticated;
  for (const error of source.errors) addError(stream, error);
}

function aggregate(summary: PollSummary): void {
  const streams = [summary.review, summary.issue, summary.mention];
  summary.fetched = streams.reduce((total, stream) => total + stream.fetched, 0);
  summary.emitted = streams.reduce((total, stream) => total + stream.emitted, 0);
  summary.duplicates = streams.reduce((total, stream) => total + stream.duplicates, 0);
  summary.filtered = streams.reduce((total, stream) => total + stream.filtered, 0);
  summary.skipped = streams.reduce((total, stream) => total + stream.skipped, 0);
  summary.deferred = streams.reduce((total, stream) => total + stream.deferred, 0);
  summary.authenticated = streams.every((stream) => stream.authenticated);
  summary.errors = [];
  for (const stream of streams) {
    for (const error of stream.errors) {
      if (summary.errors.length < MAX_ERRORS) summary.errors.push(error);
    }
  }
}

async function runReview(deps: PollDeps, now: number, summary: PollSummary, seen: Set<string>, flags: { sourceDisabled: boolean }): Promise<void> {
  const sinceMs = deps.config.windowMs > 0 ? now - deps.config.windowMs : 0;
  let result;
  try {
    result = await fetchReviewCandidates(deps.client, {
      sinceMs,
      maxResults: deps.config.maxResults,
      maxPages: deps.config.maxPages,
      includeDrafts: deps.config.includeDrafts,
      timeoutMs: deps.config.timeoutMs,
    }, deps.cache);
  } catch (error) {
    addError(summary.review, `review 流失败：${errorText(error)}`);
    return;
  }
  applyStreamMeta(summary.review, result);
  if (result.rateLimitResetAt !== undefined) summary.rateLimitResetAt = result.rateLimitResetAt;
  await processCandidates(summary.review, result.candidates as ReviewCandidate[], reviewDraft, deps, seen, now, flags);
}

async function runIssues(deps: PollDeps, now: number, summary: PollSummary, seen: Set<string>, flags: { sourceDisabled: boolean }): Promise<void> {
  const repos = deps.config.repos.slice(0, deps.config.maxRepos);
  if (repos.length === 0) return;
  const sinceMs = deps.config.windowMs > 0 ? now - deps.config.windowMs : 0;
  let result;
  try {
    result = await fetchIssueCandidates(deps.client, {
      repos,
      sinceMs,
      maxResults: deps.config.maxResults,
      maxPages: deps.config.maxPages,
      timeoutMs: deps.config.timeoutMs,
    });
  } catch (error) {
    addError(summary.issue, `issue 流失败：${errorText(error)}`);
    return;
  }
  applyStreamMeta(summary.issue, result);
  if (result.rateLimitResetAt !== undefined) summary.rateLimitResetAt = result.rateLimitResetAt;
  await processCandidates(summary.issue, result.candidates as IssueCandidate[], issueDraft, deps, seen, now, flags);
}

async function runMention(deps: PollDeps, now: number, summary: PollSummary, seen: Set<string>, flags: { sourceDisabled: boolean }): Promise<void> {
  if (deps.config.mentionMode === 'off') return;
  const windowSince = deps.config.windowMs > 0 ? now - deps.config.windowMs : 0;
  const sinceMs = Math.max(windowSince, (deps.config.mentionSinceMs ?? 0) - MENTION_OVERLAP_MS);
  let result: MentionResult;
  try {
    const options = {
      sinceMs,
      maxResults: deps.config.maxResults,
      maxPages: deps.config.maxPages,
      timeoutMs: deps.config.timeoutMs,
      ...(deps.config.login === undefined ? {} : { login: deps.config.login }),
      ...(deps.config.mentionEtag === undefined ? {} : { etag: deps.config.mentionEtag }),
    };
    result = deps.config.mentionMode === 'notifications'
      ? await fetchMentionCandidates(deps.client, options)
      : await fetchMentionSearch(deps.client, options);
  } catch (error) {
    addError(summary.mention, `mention 流失败：${errorText(error)}`);
    return;
  }
  applyStreamMeta(summary.mention, result);
  if (result.rateLimitResetAt !== undefined) summary.rateLimitResetAt = result.rateLimitResetAt;
  if (result.pollIntervalMs !== undefined) summary.pollIntervalMs = result.pollIntervalMs;
  if (result.etag !== undefined) summary.mentionEtag = result.etag;
  summary.mentionNotModified = result.notModified === true;
  summary.mentionComplete = result.complete;
  await processCandidates(summary.mention, result.candidates, mentionDraft, deps, seen, now, flags);
}

/** 扫一轮。任何单流异常都被收进摘要，不打断其他流，也不让定时器停摆。 */
export async function pollOnce(deps: PollDeps): Promise<PollSummary> {
  const now = (deps.now ?? Date.now)();
  const summary: PollSummary = {
    at: now,
    review: emptyStream(),
    issue: emptyStream(),
    mention: emptyStream(),
    fetched: 0,
    emitted: 0,
    duplicates: 0,
    filtered: 0,
    skipped: 0,
    deferred: 0,
    errors: [],
    authenticated: true,
    sourceDisabled: false,
    mentionNotModified: false,
    mentionComplete: true,
    dryRun: deps.config.dryRun,
  };
  const seenThisPoll = new Set<string>();
  const flags = { sourceDisabled: false };

  await runReview(deps, now, summary, seenThisPoll, flags);
  await runIssues(deps, now, summary, seenThisPoll, flags);
  await runMention(deps, now, summary, seenThisPoll, flags);

  summary.sourceDisabled = flags.sourceDisabled;
  aggregate(summary);
  return summary;
}

export function describeSummary(summary: PollSummary): string {
  const parts = [
    `review ${summary.review.fetched}/${summary.review.emitted}`,
    `issue ${summary.issue.fetched}/${summary.issue.emitted}`,
    `mention ${summary.mention.fetched}/${summary.mention.emitted}`,
    `去重 ${summary.duplicates}`,
  ];
  if (summary.deferred > 0) parts.push(`待上报 ${summary.deferred}`);
  if (summary.sourceDisabled) parts.push('来源未开启');
  if (summary.errors.length > 0) parts.push(`错误 ${summary.errors.length}`);
  return parts.join('，');
}

export function pollConfigOf(config: {
  windowMs: number;
  repos: string[];
  maxRepos: number;
  maxResults: number;
  maxPages: number;
  includeDrafts: boolean;
  mentionMode: MentionMode;
  timeoutMs: number;
}, extras: {
  login?: string;
  dryRun: boolean;
  mentionSinceMs?: number;
  mentionEtag?: string;
}): PollConfig {
  return {
    windowMs: config.windowMs,
    repos: [...config.repos],
    maxRepos: config.maxRepos,
    maxResults: config.maxResults,
    maxPages: config.maxPages,
    includeDrafts: config.includeDrafts,
    mentionMode: config.mentionMode,
    timeoutMs: config.timeoutMs,
    dryRun: extras.dryRun,
    ...(extras.login === undefined ? {} : { login: extras.login }),
    ...(extras.mentionSinceMs === undefined ? {} : { mentionSinceMs: extras.mentionSinceMs }),
    ...(extras.mentionEtag === undefined ? {} : { mentionEtag: extras.mentionEtag }),
  };
}
