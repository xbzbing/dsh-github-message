import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { PollSummary, StreamSummary } from '../src/poller.ts';
import { emptyStats, loadStats, MAX_HISTORY, recordStats, saveStats } from '../src/stats.ts';

function stream(overrides: Partial<StreamSummary> = {}): StreamSummary {
  return {
    fetched: 1,
    emitted: 1,
    duplicates: 0,
    filtered: 0,
    skipped: 0,
    deferred: 0,
    errors: [],
    authenticated: true,
    ...overrides,
  };
}

function summary(at: number, overrides: Partial<PollSummary> = {}): PollSummary {
  return {
    at,
    review: stream(),
    issue: stream(),
    mention: stream(),
    selfPr: stream(),
    repoPr: stream(),
    fetched: 3,
    emitted: 3,
    duplicates: 0,
    filtered: 0,
    skipped: 0,
    deferred: 0,
    errors: [],
    authenticated: true,
    sourceDisabled: false,
    mentionNotModified: false,
    mentionComplete: true,
    dryRun: false,
    ...overrides,
  };
}

test('累计三路统计并记录最近成功时间', () => {
  const stats = recordStats(emptyStats(), summary(1_000));
  assert.equal(stats.polls, 1);
  assert.equal(stats.emitted, 3);
  assert.equal(stats.byKind.review.emitted, 1);
  assert.equal(stats.byKind.issue.emitted, 1);
  assert.equal(stats.byKind.mention.emitted, 1);
  assert.equal(stats.lastPollOk, true);
  assert.equal(stats.lastSuccessAt, 1_000);
  assert.equal(stats.history.length, 1);

  const again = recordStats(stats, summary(2_000, {
    review: stream({ emitted: 2, duplicates: 1, errors: ['boom'] }),
    issue: stream({ emitted: 0, filtered: 2 }),
    mention: stream({ emitted: 0, deferred: 1 }),
    emitted: 2,
    duplicates: 1,
    filtered: 2,
    deferred: 1,
    errors: ['boom'],
  }));
  assert.equal(again.polls, 2);
  assert.equal(again.emitted, 5);
  assert.equal(again.byKind.review.errors, 1);
  assert.equal(again.lastPollOk, false);
  assert.equal(again.lastError, 'boom');
  assert.equal(again.lastErrorAt, 2_000);
  assert.equal(again.lastSuccessAt, 1_000);
});

test('历史只保留最近 MAX_HISTORY 轮', () => {
  let stats = emptyStats();
  for (let index = 0; index < MAX_HISTORY + 5; index += 1) {
    stats = recordStats(stats, summary(index));
  }
  assert.equal(stats.history.length, MAX_HISTORY);
  assert.equal(stats.history[0]?.at, 5);
});

test('未认证的一轮不算成功', () => {
  const stats = recordStats(emptyStats(), summary(1_000, { authenticated: false }));
  assert.equal(stats.lastPollOk, false);
  assert.equal(stats.lastError, 'GitHub 登录失效');
});

test('统计文件往返与损坏降级', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-github-stats-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'stats.json');
  const stats = recordStats(emptyStats(), summary(1_000));
  saveStats(file, stats);
  const loaded = loadStats(file);
  assert.equal(loaded.polls, 1);
  assert.equal(loaded.emitted, 3);
  assert.equal(loaded.byKind.review.emitted, 1);
  assert.equal(loaded.lastSuccessAt, 1_000);
  assert.equal(loaded.history.length, 1);

  assert.deepEqual(loadStats(join(dir, 'missing.json')), emptyStats());
  writeFileSync(join(dir, 'broken.json'), 'not json');
  assert.equal(loadStats(join(dir, 'broken.json')).polls, 0);
});
