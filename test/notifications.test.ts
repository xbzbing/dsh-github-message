import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GhError } from '../src/gh.ts';
import {
  apiPathFromUrl,
  fetchMentionCandidates,
  fetchMentionSearch,
  mentionExcerpt,
  subjectNumber,
} from '../src/notifications.ts';
import { FakeGh, jsonResponse, notModified, searchPage, issueSearchItem } from './fixtures/fake-gh.ts';

const OPTIONS = {
  sinceMs: Date.parse('2026-11-01T00:00:00Z'),
  maxResults: 10,
  maxPages: 3,
  timeoutMs: 1_000,
  login: 'alice',
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

test('notifications 的 mention 取评论、摘要与事件字段', async () => {
  // 评论走同一个 transport，按 endpoint 分发。
  const routed = new FakeGh((request) => {
    if (request.endpoint === 'notifications') {
      return jsonResponse([notification()], { etag: 'W/"v1"', 'x-poll-interval': '60' });
    }
    return jsonResponse(comment());
  });

  const result = await fetchMentionCandidates(routed, OPTIONS);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.etag, 'W/"v1"');
  assert.equal(result.pollIntervalMs, 60_000);
  const [candidate] = result.candidates;
  assert.equal(candidate?.repo, 'o/r');
  assert.equal(candidate?.number, 5);
  assert.equal(candidate?.commentId, '99');
  assert.equal(candidate?.author, 'bob');
  assert.equal(candidate?.via, 'notifications');
  assert.equal(candidate?.isPull, false);
  assert.ok(candidate?.excerpt.includes('@alice'));
  assert.equal(routed.calls[1]?.endpoint, 'repos/o/r/issues/comments/99');
});

test('notifications 过滤非 mention reason 与非 Issue/PR 类型', async () => {
  const gh = new FakeGh(() => jsonResponse([
    notification({ reason: 'comment' }),
    notification({ subject: { title: 'CI', url: null, latest_comment_url: null, type: 'CheckSuite' } }),
  ]));
  const result = await fetchMentionCandidates(gh, OPTIONS);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.filtered, 2);
});

test('没有评论 URL 时读正文，正文没有 @ 则过滤', async () => {
  const gh = new FakeGh((request) => {
    if (request.endpoint === 'notifications') {
      return jsonResponse([notification({
        subject: {
          title: '正文 @',
          url: 'https://api.github.com/repos/o/r/issues/5',
          latest_comment_url: null,
          type: 'Issue',
        },
      })]);
    }
    return jsonResponse({
      title: '正文 @',
      body: 'PR 描述里 @alice 补充了背景',
      user: { login: 'carol' },
      html_url: 'https://github.com/o/r/issues/5',
      created_at: '2026-11-07T08:00:00Z',
      updated_at: '2026-11-07T09:00:00Z',
    });
  });
  const result = await fetchMentionCandidates(gh, OPTIONS);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.commentId, undefined);
  assert.equal(result.candidates[0]?.author, 'carol');

  const noMention = new FakeGh((request) => {
    if (request.endpoint === 'notifications') {
      return jsonResponse([notification({
        subject: {
          title: '普通通知',
          url: 'https://api.github.com/repos/o/r/issues/5',
          latest_comment_url: null,
          type: 'Issue',
        },
      })]);
    }
    return jsonResponse({ title: '普通通知', body: '没有提到任何人', updated_at: '2026-11-07T09:00:00Z' });
  });
  const filtered = await fetchMentionCandidates(noMention, OPTIONS);
  assert.equal(filtered.candidates.length, 0);
  assert.equal(filtered.filtered, 1);
});

test('team_mention 接受任意 @，个人 mention 必须匹配当前账号', async () => {
  const team = new FakeGh((request) => {
    if (request.endpoint === 'notifications') {
      return jsonResponse([notification({ reason: 'team_mention' })]);
    }
    return jsonResponse(comment({ body: '@team-labs 请确认' }));
  });
  const result = await fetchMentionCandidates(team, OPTIONS);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.reason, 'team_mention');

  const other = new FakeGh((request) => {
    if (request.endpoint === 'notifications') return jsonResponse([notification()]);
    return jsonResponse(comment({ body: '@bob 请确认' }));
  });
  const personal = await fetchMentionCandidates(other, OPTIONS);
  assert.equal(personal.candidates.length, 0);
  assert.equal(personal.filtered, 1);
});

test('304 视为无变化，保留 ETag', async () => {
  const gh = new FakeGh(() => notModified({ etag: '"v2"', 'x-poll-interval': '90' }));
  const result = await fetchMentionCandidates(gh, { ...OPTIONS, etag: '"v1"' });
  assert.equal(result.notModified, true);
  assert.equal(result.etag, '"v2"');
  assert.equal(result.pollIntervalMs, 90_000);
  assert.equal(gh.calls[0]?.headers?.['If-None-Match'], '"v1"');
});

test('评论 404 计 filtered，网络错误计 errors 且不完整', async () => {
  const missing = new FakeGh((request) => {
    if (request.endpoint === 'notifications') return jsonResponse([notification()]);
    throw new GhError('not-found', 'gh: Not Found (HTTP 404)', 404);
  });
  const filtered = await fetchMentionCandidates(missing, OPTIONS);
  assert.equal(filtered.filtered, 1);
  assert.equal(filtered.complete, true);

  const broken = new FakeGh((request) => {
    if (request.endpoint === 'notifications') return jsonResponse([notification()]);
    throw new GhError('network', 'timeout');
  });
  const failed = await fetchMentionCandidates(broken, OPTIONS);
  assert.equal(failed.complete, false);
  assert.equal(failed.errors.length, 1);
});

test('search 降级：正文命中 @ 直接产出，评论命中读取评论列表', async () => {
  const bodyHit = new FakeGh(() => searchPage([
    issueSearchItem({
      number: 11,
      title: '正文提到我',
      body: '请 @alice 看一下',
      updated_at: '2026-11-07T09:00:00Z',
    }),
  ]));
  const direct = await fetchMentionSearch(bodyHit, OPTIONS);
  assert.equal(direct.candidates.length, 1);
  assert.equal(direct.candidates[0]?.via, 'search');
  assert.equal(direct.candidates[0]?.commentId, undefined);

  const commentHit = new FakeGh((request) => {
    if (request.endpoint === 'search/issues') {
      return searchPage([issueSearchItem({ number: 11, title: '评论提到我', body: '正文没有提到任何人' })]);
    }
    return jsonResponse([comment({ id: 123, body: '这里 @alice 再看一下' })]);
  });
  const viaComment = await fetchMentionSearch(commentHit, OPTIONS);
  assert.equal(viaComment.candidates.length, 1);
  assert.equal(viaComment.candidates[0]?.commentId, '123');
  assert.equal(commentHit.calls[1]?.endpoint, 'repos/xbzbing/dsh-my-superagent/issues/11/comments');
});

test('search 降级会翻页找评论，保留最新命中', async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => comment({
    id: 200 + index,
    body: `第 ${index} 条，没有提到谁`,
    updated_at: '2026-11-07T08:00:00Z',
  }));
  const secondPage = [comment({ id: 999, body: '最新一条 @alice 请看', updated_at: '2026-11-07T09:00:00Z' })];
  const gh = new FakeGh((request) => {
    if (request.endpoint === 'search/issues') {
      return searchPage([issueSearchItem({ number: 11, title: '评论提到我', body: '正文没有提到任何人' })]);
    }
    if (request.endpoint === 'repos/xbzbing/dsh-my-superagent/issues/11/comments') {
      return jsonResponse(request.params?.page === 2 ? secondPage : firstPage);
    }
    throw new Error(`unexpected ${request.endpoint}`);
  });
  const result = await fetchMentionSearch(gh, OPTIONS);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.commentId, '999');
  assert.ok(result.candidates[0]?.excerpt.includes('@alice'));
  assert.equal(gh.calls.filter((call) => call.endpoint.endsWith('/comments')).length, 2);
});

test('apiPathFromUrl 只接受 api.github.com 的评论路径', () => {
  assert.equal(
    apiPathFromUrl('https://api.github.com/repos/o/r/issues/comments/1'),
    'repos/o/r/issues/comments/1',
  );
  assert.equal(
    apiPathFromUrl('https://api.github.com/repos/o/r/pulls/comments/2'),
    'repos/o/r/pulls/comments/2',
  );
  assert.equal(apiPathFromUrl('https://api.github.com/repos/o/r/issues/1'), undefined);
  assert.equal(apiPathFromUrl('https://api.github.com/repos/o/r/actions/runs/1'), undefined);
  assert.equal(apiPathFromUrl('https://evil.example/repos/o/r/issues/1'), undefined);
  assert.equal(apiPathFromUrl('http://api.github.com/repos/o/r/issues/1'), undefined);
  assert.equal(apiPathFromUrl('https://api.github.com/user'), undefined);
  assert.equal(apiPathFromUrl(null), undefined);
  assert.equal(subjectNumber('https://api.github.com/repos/o/r/pulls/42'), 42);
  assert.equal(subjectNumber('https://api.github.com/repos/o/r/issues/7'), 7);
  assert.equal(subjectNumber(null), undefined);
});

test('mentionExcerpt 截取 @ 附近文本并压成单行', () => {
  const excerpt = mentionExcerpt('第一行\n\n第二行 @alice 请看', 'alice');
  assert.ok(excerpt?.includes('@alice'));
  assert.ok(!excerpt?.includes('\n'));
  assert.equal(mentionExcerpt('没有提到', 'alice'), undefined);
  assert.equal(mentionExcerpt(null, 'alice'), undefined);
});
