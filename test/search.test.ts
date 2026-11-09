import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GhError } from '../src/gh.ts';
import {
  fetchIssueCandidates,
  fetchReviewCandidates,
  issueQuery,
  orgIssueQuery,
  ownedIssueQuery,
  PullCache,
  REVIEW_QUERY,
} from '../src/search.ts';
import { FakeGh, issueSearchItem, jsonResponse, prDetail, prSearchItem, searchPage } from './fixtures/fake-gh.ts';

const SINCE = Date.parse('2026-11-01T00:00:00Z');
const OPTIONS = { sinceMs: SINCE, maxResults: 10, maxPages: 3, includeDrafts: true, timeoutMs: 1_000 };

test('review 查询补 PR 详情并产出候选', async () => {
  const gh = new FakeGh((request) => {
    if (request.endpoint === 'search/issues') return searchPage([prSearchItem()]);
    return jsonResponse(prDetail());
  });

  const result = await fetchReviewCandidates(gh, OPTIONS);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.fetched, 1);
  assert.equal(result.errors.length, 0);
  const [candidate] = result.candidates;
  assert.equal(candidate?.repo, 'xbzbing/dsh-my-superagent');
  assert.equal(candidate?.number, 42);
  assert.equal(candidate?.headSha, 'a'.repeat(40));
  assert.equal(candidate?.baseRef, 'main');
  assert.equal(candidate?.author, 'alice');
  assert.equal(gh.calls[0]?.params?.q, REVIEW_QUERY);
  assert.equal(gh.calls[1]?.endpoint, 'repos/xbzbing/dsh-my-superagent/pulls/42');
});

test('review 过滤合并、关闭、窗口外与 draft', async () => {
  const details = [
    prDetail({ merged: true }),
    prDetail({ state: 'closed' }),
    prDetail({ updated_at: '2026-10-01T00:00:00Z' }),
    prDetail({ draft: true }),
    prDetail({ head: { sha: 'not-a-sha' } }),
  ];
  let index = 0;
  const gh = new FakeGh((request) => {
    if (request.endpoint === 'search/issues') {
      return searchPage(details.map((_, position) => prSearchItem({ number: 40 + position })));
    }
    const detail = details[index];
    index += 1;
    return jsonResponse(detail);
  });

  const result = await fetchReviewCandidates(gh, { ...OPTIONS, includeDrafts: false });
  assert.equal(result.candidates.length, 0);
  assert.equal(result.filtered, 4);
  assert.equal(result.skipped, 1);
});

test('review 详情 404 计 filtered，其他错误计 errors', async () => {
  let call = 0;
  const gh = new FakeGh((request) => {
    if (request.endpoint === 'search/issues') return searchPage([prSearchItem(), prSearchItem()]);
    call += 1;
    if (call === 1) throw new GhError('not-found', 'gh: Not Found (HTTP 404)', 404);
    throw new GhError('network', 'timeout');
  });
  const result = await fetchReviewCandidates(gh, OPTIONS);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.filtered, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.authenticated, true);
});

test('review 搜索 401 时标记未认证', async () => {
  const gh = new FakeGh(() => {
    throw new GhError('unauthenticated', 'gh: Bad credentials (HTTP 401)', 401);
  });
  const result = await fetchReviewCandidates(gh, OPTIONS);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.authenticated, false);
  assert.equal(result.errors.length, 1);
});

test('PR 详情缓存按 updated_at 命中', async () => {
  const gh = new FakeGh((request) => {
    if (request.endpoint === 'search/issues') return searchPage([prSearchItem()]);
    return jsonResponse(prDetail());
  });
  const cache = new PullCache(10);
  await fetchReviewCandidates(gh, OPTIONS, cache);
  await fetchReviewCandidates(gh, OPTIONS, cache);
  const detailCalls = gh.calls.filter((call) => call.endpoint.startsWith('repos/'));
  assert.equal(detailCalls.length, 1);
  assert.equal(cache.size, 1);
  assert.equal(cache.get('xbzbing/dsh-my-superagent', 42, '2026-11-07T08:00:00Z')?.headSha, 'a'.repeat(40));
  assert.equal(cache.get('xbzbing/dsh-my-superagent', 42, '2026-11-08T08:00:00Z'), undefined);
});

test('review 分页按 maxResults 停止', async () => {
  const gh = new FakeGh((request) => {
    if (request.endpoint === 'search/issues') {
      return searchPage(request.params?.page === 1 ? [prSearchItem(), prSearchItem()] : [prSearchItem()]);
    }
    return jsonResponse(prDetail());
  });
  const result = await fetchReviewCandidates(gh, { ...OPTIONS, maxResults: 2 });
  assert.equal(result.candidates.length, 2);
  const searches = gh.calls.filter((call) => call.endpoint === 'search/issues');
  assert.equal(searches.length, 1);
});

test('issue 查询按仓库、排除 PR、过滤窗口外', async () => {
  const gh = new FakeGh(() => searchPage([
    issueSearchItem(),
    issueSearchItem({ number: 8, pull_request: { url: 'x' } }),
    issueSearchItem({ number: 9, created_at: '2026-10-01T00:00:00Z' }),
    issueSearchItem({ number: 10, repository_url: 'https://api.github.com/repos/other/repo' }),
  ]));
  const result = await fetchIssueCandidates(gh, {
    repos: ['xbzbing/dsh-my-superagent'],
    orgs: [],
    scope: 'repos',
    sinceMs: SINCE,
    maxResults: 10,
    maxPages: 3,
    timeoutMs: 1_000,
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.number, 7);
  assert.deepEqual(result.candidates[0]?.labels, ['enhancement']);
  assert.equal(result.filtered, 3);
  assert.ok(issueQuery('xbzbing/dsh-my-superagent', SINCE).includes('created:>=2026-10-31'));
  assert.equal(issueQuery('o/r', 0), 'repo:o/r is:issue is:open');
  assert.equal(ownedIssueQuery(0), 'user:@me is:issue is:open');
  assert.equal(orgIssueQuery('my-org', 0), 'org:my-org is:issue is:open');
});

test('issue 单个仓库失败不影响其他仓库', async () => {
  let searchCalls = 0;
  const gh = new FakeGh(() => {
    searchCalls += 1;
    if (searchCalls === 1) throw new GhError('not-found', 'gh: Not Found (HTTP 404)', 404);
    return searchPage([issueSearchItem({ repository_url: 'https://api.github.com/repos/o/two' })]);
  });
  const result = await fetchIssueCandidates(gh, {
    repos: ['o/one', 'o/two'],
    orgs: [],
    scope: 'repos',
    sinceMs: 0,
    maxResults: 10,
    maxPages: 1,
    timeoutMs: 1_000,
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.fetched, 1);
});

test('issue 多仓库按创建时间归并，不被第一个仓库占满预算', async () => {
  const gh = new FakeGh((request) => {
    const query = String(request.params?.q ?? '');
    if (query.startsWith('repo:o/one')) {
      return searchPage([
        issueSearchItem({ repository_url: 'https://api.github.com/repos/o/one', number: 1, created_at: '2026-11-02T00:00:00Z' }),
        issueSearchItem({ repository_url: 'https://api.github.com/repos/o/one', number: 2, created_at: '2026-11-03T00:00:00Z' }),
      ]);
    }
    return searchPage([
      issueSearchItem({ repository_url: 'https://api.github.com/repos/o/two', number: 3, created_at: '2026-11-06T00:00:00Z' }),
    ]);
  });
  const result = await fetchIssueCandidates(gh, {
    repos: ['o/one', 'o/two'],
    orgs: [],
    scope: 'repos',
    sinceMs: 0,
    maxResults: 2,
    maxPages: 1,
    timeoutMs: 1_000,
  });
  assert.deepEqual(result.candidates.map((item) => item.number), [3, 2]);
});

test('owned 模式查 user:@me 与组织，并按 repo#number 跨来源去重', async () => {
  const gh = new FakeGh((request) => {
    const query = String(request.params?.q ?? '');
    if (query.startsWith('user:@me')) {
      return searchPage([
        issueSearchItem({ repository_url: 'https://api.github.com/repos/alice/one', number: 1, created_at: '2026-11-05T00:00:00Z' }),
        issueSearchItem({ repository_url: 'https://api.github.com/repos/alice/two', number: 2, created_at: '2026-11-04T00:00:00Z' }),
      ]);
    }
    if (query.startsWith('org:my-org')) {
      return searchPage([
        issueSearchItem({ repository_url: 'https://api.github.com/repos/my-org/three', number: 3, created_at: '2026-11-06T00:00:00Z' }),
        // 组织查询里串进个人仓库，应被 owner 校验过滤。
        issueSearchItem({ repository_url: 'https://api.github.com/repos/alice/one', number: 9 }),
      ]);
    }
    if (query.startsWith('repo:alice/one')) {
      return searchPage([
        issueSearchItem({ repository_url: 'https://api.github.com/repos/alice/one', number: 1, created_at: '2026-11-05T00:00:00Z' }),
      ]);
    }
    return searchPage([]);
  });
  const result = await fetchIssueCandidates(gh, {
    repos: ['alice/one'],
    orgs: ['my-org'],
    scope: 'owned',
    sinceMs: 0,
    maxResults: 10,
    maxPages: 1,
    timeoutMs: 1_000,
  });
  assert.deepEqual(result.candidates.map((item) => `${item.repo}#${item.number}`), [
    'my-org/three#3',
    'alice/one#1',
    'alice/two#2',
  ]);
  // 组织查询里的 alice/one#9 被 owner 过滤；显式仓库重复的 alice/one#1 被跨来源去重。
  assert.equal(result.filtered, 2);
  const queries = gh.calls.map((call) => String(call.params?.q ?? ''));
  assert.deepEqual(queries, [
    ownedIssueQuery(0),
    orgIssueQuery('my-org', 0),
    issueQuery('alice/one', 0),
  ]);
});

test('repos 模式忽略 orgs，只查仓库列表', async () => {
  const gh = new FakeGh(() => searchPage([]));
  await fetchIssueCandidates(gh, {
    repos: ['o/r'],
    orgs: ['my-org'],
    scope: 'repos',
    sinceMs: 0,
    maxResults: 10,
    maxPages: 1,
    timeoutMs: 1_000,
  });
  assert.deepEqual(gh.calls.map((call) => String(call.params?.q ?? '')), [issueQuery('o/r', 0)]);
});

test('owned 模式跳过非法组织名，不拼进搜索语句', async () => {
  const gh = new FakeGh(() => searchPage([]));
  const result = await fetchIssueCandidates(gh, {
    repos: [],
    orgs: ['bad_org'],
    scope: 'owned',
    sinceMs: 0,
    maxResults: 10,
    maxPages: 1,
    timeoutMs: 1_000,
  });
  assert.equal(result.skipped, 1);
  assert.deepEqual(gh.calls.map((call) => String(call.params?.q ?? '')), [ownedIssueQuery(0)]);
});

test('坏记录计入 skipped，不中断整页', async () => {
  const gh = new FakeGh(() => searchPage([
    { number: 'x', repository_url: 'https://api.github.com/repos/o/r' },
    issueSearchItem(),
  ]));
  const result = await fetchIssueCandidates(gh, {
    repos: ['xbzbing/dsh-my-superagent'],
    orgs: [],
    scope: 'repos',
    sinceMs: 0,
    maxResults: 10,
    maxPages: 1,
    timeoutMs: 1_000,
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.skipped, 1);
});

