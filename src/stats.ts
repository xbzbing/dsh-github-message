// 轮询统计：累计计数（含三路拆分）+ 最近若干轮摘要。面板重启后仍能看到历史。

import { readJsonFile, writeJsonFile, type FileLogger } from './json-file.ts';
import type { PollSummary, StreamSummary } from './poller.ts';

export const MAX_HISTORY = 20;

export type StreamName = 'review' | 'issue' | 'mention' | 'selfPr' | 'repoPr';

export interface KindStats {
  emitted: number;
  duplicates: number;
  filtered: number;
  skipped: number;
  deferred: number;
  errors: number;
}

export interface PollStats {
  polls: number;
  emitted: number;
  duplicates: number;
  filtered: number;
  skipped: number;
  deferred: number;
  errors: number;
  byKind: Record<StreamName, KindStats>;
  lastPollAt?: number;
  lastPollOk?: boolean;
  lastEmittedAt?: number;
  lastSuccessAt?: number;
  lastError?: string;
  lastErrorAt?: number;
  history: PollSummary[];
}

const STREAMS: readonly StreamName[] = ['review', 'issue', 'mention', 'selfPr', 'repoPr'];

function emptyKind(): KindStats {
  return { emitted: 0, duplicates: 0, filtered: 0, skipped: 0, deferred: 0, errors: 0 };
}

export function emptyStats(): PollStats {
  return {
    polls: 0,
    emitted: 0,
    duplicates: 0,
    filtered: 0,
    skipped: 0,
    deferred: 0,
    errors: 0,
    byKind: { review: emptyKind(), issue: emptyKind(), mention: emptyKind(), selfPr: emptyKind(), repoPr: emptyKind() },
    history: [],
  };
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

function stamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function loadKind(value: unknown): KindStats {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return emptyKind();
  const raw = value as Record<string, unknown>;
  return {
    emitted: count(raw.emitted),
    duplicates: count(raw.duplicates),
    filtered: count(raw.filtered),
    skipped: count(raw.skipped),
    deferred: count(raw.deferred),
    errors: count(raw.errors),
  };
}

function isSummary(value: unknown): value is PollSummary {
  return value !== null && typeof value === 'object'
    && typeof (value as { at?: unknown }).at === 'number'
    && (value as { review?: unknown }).review !== undefined;
}

export function loadStats(file: string | undefined, logger?: FileLogger): PollStats {
  const raw = readJsonFile(file, logger);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return emptyStats();
  const value = raw as Record<string, unknown>;
  const history = Array.isArray(value.history)
    ? value.history.filter(isSummary).slice(-MAX_HISTORY)
    : [];
  const byKindValue = value.byKind !== null && typeof value.byKind === 'object' && !Array.isArray(value.byKind)
    ? value.byKind as Record<string, unknown>
    : {};
  const stats: PollStats = {
    polls: count(value.polls),
    emitted: count(value.emitted),
    duplicates: count(value.duplicates),
    filtered: count(value.filtered),
    skipped: count(value.skipped),
    deferred: count(value.deferred),
    errors: count(value.errors),
    byKind: {
      review: loadKind(byKindValue.review),
      issue: loadKind(byKindValue.issue),
      mention: loadKind(byKindValue.mention),
      selfPr: loadKind(byKindValue.selfPr),
      repoPr: loadKind(byKindValue.repoPr),
    },
    history,
  };
  const lastPollAt = stamp(value.lastPollAt);
  const lastEmittedAt = stamp(value.lastEmittedAt);
  const lastSuccessAt = stamp(value.lastSuccessAt);
  const lastErrorAt = stamp(value.lastErrorAt);
  if (lastPollAt !== undefined) stats.lastPollAt = lastPollAt;
  if (lastEmittedAt !== undefined) stats.lastEmittedAt = lastEmittedAt;
  if (lastSuccessAt !== undefined) stats.lastSuccessAt = lastSuccessAt;
  if (lastErrorAt !== undefined) stats.lastErrorAt = lastErrorAt;
  if (typeof value.lastPollOk === 'boolean') stats.lastPollOk = value.lastPollOk;
  if (typeof value.lastError === 'string' && value.lastError !== '') stats.lastError = value.lastError;
  return stats;
}

export function saveStats(file: string | undefined, stats: PollStats, logger?: FileLogger): void {
  writeJsonFile(file, { version: 2, ...stats }, logger);
}

function addKind(stats: PollStats, name: StreamName, stream: StreamSummary): void {
  const current = stats.byKind[name];
  stats.byKind[name] = {
    emitted: current.emitted + stream.emitted,
    duplicates: current.duplicates + stream.duplicates,
    filtered: current.filtered + stream.filtered,
    skipped: current.skipped + stream.skipped,
    deferred: current.deferred + stream.deferred,
    errors: current.errors + stream.errors.length,
  };
}

export function recordStats(stats: PollStats, summary: PollSummary): PollStats {
  const next: PollStats = {
    ...stats,
    byKind: { ...stats.byKind },
    polls: stats.polls + 1,
    emitted: stats.emitted + summary.emitted,
    duplicates: stats.duplicates + summary.duplicates,
    filtered: stats.filtered + summary.filtered,
    skipped: stats.skipped + summary.skipped,
    deferred: stats.deferred + summary.deferred,
    errors: stats.errors + summary.errors.length,
    lastPollAt: summary.at,
    lastPollOk: summary.errors.length === 0 && summary.authenticated,
    history: [...stats.history, summary].slice(-MAX_HISTORY),
  };
  for (const name of STREAMS) addKind(next, name, summary[name]);
  if (summary.emitted > 0) next.lastEmittedAt = summary.at;
  if (next.lastPollOk === true) {
    next.lastSuccessAt = summary.at;
  } else {
    next.lastError = summary.errors[0] ?? (summary.authenticated ? '轮询失败' : 'GitHub 登录失效');
    next.lastErrorAt = summary.at;
  }
  return next;
}
