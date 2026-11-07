import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GhError } from '../src/gh.ts';
import {
  describeSummary,
  pollOnce,
  type EmitResultLike,
  type PollConfig,
  type SourceHandleLike,
} from '../src/poller.ts';
import { REVIEW_QUERY } from '../src/search.ts';
import type { SignalDraft } from '../src/signals.ts';
import { MemorySeen } from '../src/state.ts';
import {
  FakeGh,
  issueSearchItem,
  jsonResponse,
  prDetail,
  prSearchItem,
  searchPage,
} from './fixtures/fake-gh.ts';

const NOW = Date.parse('2026-11-07T12:00:00Z');
const DAY = 24 * 60 * 60_000;

const CONFIG: PollConfig = {
  windowMs: 7 * DAY,
  repos: ['xbzbing/dsh-my-superagent'],
  maxRepos: 10,
  maxResults: 100,
  maxPages: 3,
  includeDrafts: true,
  mentionMode: 'notifications',
  timeoutMs: 1_000,
  login: 'alice',
  dryRun: false,
};

function notification(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '1001',
    reason: 'mention',
    updated_at: '2026-11-07T09:00:00Z',
    subject: {
      title: '讨论 GitHub 来源',
      url: 'https://api.github.com/repos/o/r/issues/5',
      latest_comment_url: 'https://api.github.com/repos/o/r/issues/comments/99',
      type: 'Issue',
    },
    repository: { full_name: 'o/r' },
    ...overrides,
  };
}

function comment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 99,
    body: '麻烦 @alice 看一下这个方案，谢谢',
    user: { login: 'bob' },
    html_url: 'https://github.com/o/r/issues/5#issuecomment-99',
    created_at: '2026-11-07T08:50:00Z',
    updated_at: '2026-11-07T09:00:00Z',
    ...overrides,
  };
}

interface HandlerOptions {
  reviewItem?: unknown;
  reviewDetail?: unknown;
  issueItem?: unknown;
  notificationItem?: unknown;
  commentItem?: unknown;
  reviewError?: Error;
  notificationsError?: Error;
}

function happyHandler(options: HandlerOptions = {}) {
  return (request: { endpoint: string; params?: Record<string, unknown> }) => {
    if (request.endpoint === 'search/issues') {
      const query = String(request.params?.q ?? '');
      if (query === REVIEW_QUERY) {
        if (options.reviewError !== undefined) throw options.reviewError;
        return searchPage([options.reviewItem ?? prSearchItem()]);
      }
      if (query.startsWith('repo:')) return searchPage([options.issueItem ?? issueSearchItem()]);
      return searchPage([]);
    }
    if (request.endpoint === 'notifications') {
      if (options.notificationsError !== undefined) throw options.notificationsError;
      return jsonResponse([options.notificationItem ?? notification()], { etag: 'W/"v1"', 'x-poll-interval': '60' });
    }
    if (request.endpoint.includes('/pulls/42')) return jsonResponse(options.reviewDetail ?? prDetail());
    if (request.endpoint.endsWith('/comments/99')) return jsonResponse(options.commentItem ?? comment());
    throw new Error(`unexpected endpoint ${request.endpoint}`);
  };
}

function collector(drafts: SignalDraft[], result?: (draft: SignalDraft) => EmitResultLike): SourceHandleLike {
  return {
    async emit(draft) {
      drafts.push(draft);
      return result?.(draft) ?? { accepted: true, id: `id-${drafts.length}`, duplicate: false };
    },
  };
}

function depsOf(gh: FakeGh, drafts: SignalDraft[], seen = new MemorySeen(), config: Partial<PollConfig> = {}) {
  return {
    client: gh,
    handle: collector(drafts),
    config: { ...CONFIG, ...config },
    seen,
    now: () => NOW,
  };
}

test('一轮同时产出 review、issue、mention 三类信号', async () => {
  const gh = new FakeGh(happyHandler());
  const drafts: SignalDraft[] = [];
  const summary = await pollOnce(depsOf(gh, drafts));

  assert.equal(summary.emitted, 3);
  assert.equal(summary.review.fetched, 1);
  assert.equal(summary.issue.fetched, 1);
  assert.equal(summary.mention.fetched, 1);
  assert.equal(summary.errors.length, 0);
  assert.equal(summary.authenticated, true);
  assert.equal(summary.sourceDisabled, false);
  assert.equal(summary.mentionEtag, 'W/"v1"');
  assert.equal(summary.pollIntervalMs, 60_000);

  const byKind = new Map(drafts.map((draft) => [draft.kind, draft]));
  assert.equal(byKind.get('code-review.requested')?.subject, 'github:xbzbing/dsh-my-superagent/pull/42');
  assert.equal(byKind.get('code-review.requested')?.sourceEventId, `review:xbzbing/dsh-my-superagent#42:${'a'.repeat(40)}`);
  assert.equal(byKind.get('github.issue.opened')?.sourceEventId, 'issue:xbzbing/dsh-my-superagent#7');
  assert.equal(byKind.get('github.mention')?.sourceEventId, 'mention:o/r#5:99');
  assert.equal(byKind.get('github.mention')?.payload?.commentId, '99');
  assert.ok(describeSummary(summary).includes('review 1/1'));
});

test('同一事实第二轮不再上报', async () => {
  const gh = new FakeGh(happyHandler());
  const drafts: SignalDraft[] = [];
  const seen = new MemorySeen();
  const deps = depsOf(gh, drafts, seen);
  await pollOnce(deps);
  const second = await pollOnce(deps);

  assert.equal(second.emitted, 0);
  assert.equal(second.duplicates, 3);
  assert.equal(seen.size, 3);
});

test('PR 新 commit 产生新事件', async () => {
  const seen = new MemorySeen();
  let head = 'a'.repeat(40);
  let updated = '2026-11-07T08:00:00Z';
  const gh = new FakeGh((request) => {
    if (request.endpoint === 'search/issues') {
      if (String(request.params?.q) === REVIEW_QUERY) {
        return searchPage([prSearchItem({ updated_at: updated })]);
      }
      return searchPage([]);
    }
    if (request.endpoint.includes('/pulls/42')) return jsonResponse(prDetail({ head: { sha: head }, updated_at: updated }));
    throw new Error(`unexpected ${request.endpoint}`);
  });
  const drafts: SignalDraft[] = [];
  const deps = {
    ...depsOf(gh, drafts, seen),
    config: { ...CONFIG, repos: [], mentionMode: 'off' as const },
  };
  await pollOnce(deps);
  head = 'b'.repeat(40);
  updated = '2026-11-07T10:00:00Z';
  const second = await pollOnce(deps);

  assert.equal(second.emitted, 1);
  assert.equal(drafts.length, 2);
  assert.equal(drafts[1]?.sourceEventId, `review:xbzbing/dsh-my-superagent#42:${'b'.repeat(40)}`);
});

test('dryRun 只采集不 emit、不写 seen', async () => {
  const gh = new FakeGh(happyHandler());
  const seen = new MemorySeen();
  const deps = { ...depsOf(gh, [], seen), config: { ...CONFIG, dryRun: true } };
  const summary = await pollOnce(deps);
  assert.equal(summary.emitted, 0);
  assert.equal(summary.deferred, 3);
  assert.equal(seen.size, 0);

  const again = await pollOnce(deps);
  assert.equal(again.deferred, 3);
  assert.equal(again.duplicates, 0);
});

test('来源关闭时不写 seen，下一轮重试', async () => {
  const gh = new FakeGh(happyHandler());
  const drafts: SignalDraft[] = [];
  const seen = new MemorySeen();
  const deps = {
    ...depsOf(gh, drafts, seen),
    handle: collector(drafts, () => ({ accepted: false, reason: 'source-disabled' })),
  };
  const first = await pollOnce(deps);
  assert.equal(first.emitted, 0);
  assert.equal(first.deferred, 3);
  assert.equal(first.sourceDisabled, true);
  assert.equal(seen.size, 0);

  const second = await pollOnce(deps);
  assert.equal(second.deferred, 3);
  assert.equal(second.duplicates, 0);
});

test('核心判定 duplicate 时写 seen 并计 duplicate', async () => {
  const gh = new FakeGh(happyHandler());
  const drafts: SignalDraft[] = [];
  const seen = new MemorySeen();
  const deps = {
    ...depsOf(gh, drafts, seen),
    handle: collector(drafts, () => ({ accepted: true, id: 'x', duplicate: true })),
  };
  const summary = await pollOnce(deps);
  assert.equal(summary.duplicates, 3);
  assert.equal(summary.emitted, 0);
  assert.equal(seen.size, 3);
});

test('一个流失败不影响另外两个流', async () => {
  const gh = new FakeGh(happyHandler({ reviewError: new GhError('network', 'network down') }));
  const drafts: SignalDraft[] = [];
  const summary = await pollOnce(depsOf(gh, drafts));
  assert.equal(summary.emitted, 2);
  assert.equal(summary.review.errors.length, 1);
  assert.equal(summary.issue.emitted, 1);
  assert.equal(summary.mention.emitted, 1);
  assert.equal(summary.authenticated, true);
});

test('401 让整轮标记未认证，但其他流仍执行', async () => {
  const gh = new FakeGh(happyHandler({ reviewError: new GhError('unauthenticated', 'bad credentials', 401) }));
  const drafts: SignalDraft[] = [];
  const summary = await pollOnce(depsOf(gh, drafts));
  assert.equal(summary.authenticated, false);
  assert.equal(summary.emitted, 2);
});

test('mentionMode=off 不请求 notifications', async () => {
  const gh = new FakeGh(happyHandler());
  const drafts: SignalDraft[] = [];
  const summary = await pollOnce(depsOf(gh, drafts, new MemorySeen(), { mentionMode: 'off' }));
  assert.equal(summary.mention.fetched, 0);
  assert.equal(gh.calls.some((call) => call.endpoint === 'notifications'), false);
});

test('mentionSince 叠加 10 分钟重叠', async () => {
  const gh = new FakeGh(happyHandler());
  const since = NOW - 60 * 60_000;
  await pollOnce(depsOf(gh, [], new MemorySeen(), { mentionSinceMs: since }));
  const call = gh.calls.find((item) => item.endpoint === 'notifications');
  assert.equal(call?.params?.since, new Date(since - 10 * 60_000).toISOString());
  assert.equal(call?.params?.all, true);
});

test('限流重置时间进入摘要', async () => {
  const reset = NOW + 30 * 60_000;
  const limited = new FakeGh((request) => {
    if (request.endpoint === 'search/issues') return searchPage([]);
    if (request.endpoint === 'notifications') {
      throw new GhError('rate-limited', 'rate limit', undefined, reset);
    }
    throw new Error('unexpected');
  });
  const summary = await pollOnce(depsOf(limited, [], new MemorySeen(), { repos: [] }));
  assert.equal(summary.rateLimitResetAt, reset);
  assert.equal(summary.mention.errors.length, 1);
});

test('304 记入 mentionNotModified 并保留 GitHub 的轮询间隔', async () => {
  const gh = new FakeGh((request) => {
    if (request.endpoint === 'search/issues') return searchPage([]);
    if (request.endpoint === 'notifications') {
      return { status: 304, headers: { etag: 'W/"v2"', 'x-poll-interval': '90' }, body: '' };
    }
    throw new Error('unexpected');
  });
  const summary = await pollOnce(depsOf(gh, [], new MemorySeen(), { repos: [] }));
  assert.equal(summary.mentionNotModified, true);
  assert.equal(summary.mentionEtag, 'W/"v2"');
  assert.equal(summary.pollIntervalMs, 90_000);
  assert.equal(summary.emitted, 0);
});
