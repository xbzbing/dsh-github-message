#!/usr/bin/env node
// 真实只读 smoke：用本机 gh 跑一遍登录、review、mention 查询，只打印摘要。
// 不创建/修改任何 GitHub 资源，不写插件状态，不发信号。

import { createGhClient } from '../src/gh.ts';
import { probeLogin } from '../src/login.ts';
import { fetchMentionCandidates } from '../src/notifications.ts';
import { fetchIssueCandidates, fetchReviewCandidates } from '../src/search.ts';

const DAY = 24 * 60 * 60_000;
const client = createGhClient(process.env.DSH_GITHUB_CLI ?? 'gh');
const timeoutMs = 20_000;
const sinceMs = Date.now() - 7 * DAY;

function summarize(name, result) {
  const errors = result.errors.length > 0 ? `，错误 ${result.errors.join(' | ')}` : '';
  process.stdout.write(
    `${name}: 拉取 ${result.fetched}，候选 ${result.candidates.length}，过滤 ${result.filtered}，跳过 ${result.skipped}${errors}\n`,
  );
  for (const candidate of result.candidates.slice(0, 5)) {
    process.stdout.write(`  - ${candidate.repo} #${candidate.number} ${candidate.title}\n`);
  }
}

const login = await probeLogin(client, timeoutMs);
process.stdout.write(
  `login: installed=${String(login.installed)} authenticated=${String(login.authenticated)} api=${login.api} `
  + `user=${login.username ?? '—'} scopes=${login.scopes.join(',') || '—'} notifications=${login.notifications}\n`,
);

summarize('review', await fetchReviewCandidates(client, {
  sinceMs,
  maxResults: 5,
  maxPages: 1,
  includeDrafts: true,
  timeoutMs,
}));

const repos = (process.env.DSH_SMOKE_REPOS ?? '').split(',').map((repo) => repo.trim()).filter((repo) => repo !== '');
const orgs = (process.env.DSH_SMOKE_ORGS ?? '').split(',').map((org) => org.trim()).filter((org) => org !== '');
const scope = process.env.DSH_SMOKE_ISSUE_SCOPE === 'owned' ? 'owned' : 'repos';
if (repos.length > 0 || scope === 'owned') {
  summarize('issue', await fetchIssueCandidates(client, {
    repos,
    orgs,
    scope,
    sinceMs,
    maxResults: 5,
    maxPages: 1,
    timeoutMs,
  }));
} else {
  process.stdout.write('issue: 跳过（设置 DSH_SMOKE_REPOS=owner/repo 或 DSH_SMOKE_ISSUE_SCOPE=owned 可测试）\n');
}

summarize('mention', await fetchMentionCandidates(client, {
  sinceMs,
  maxResults: 5,
  maxPages: 1,
  timeoutMs,
  ...(login.username === undefined ? {} : { login: login.username }),
}));
