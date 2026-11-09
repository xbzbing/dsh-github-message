import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_INTERVAL_MS,
  DEFAULT_ISSUE_SCOPE,
  DEFAULT_MAX_ORGS,
  DEFAULT_MAX_REPOS,
  DEFAULT_WINDOW_MS,
  MAX_INTERVAL_MS,
  MIN_INTERVAL_MS,
  normalizeOrg,
  normalizeRepo,
  parseOrgs,
  parseRepos,
  resolveConfig,
} from '../src/config.ts';

const ENV = { env: {}, home: '/home/tester' };

test('默认配置：5 分钟、7 天、空仓库列表', () => {
  const config = resolveConfig({}, ENV);
  assert.equal(config.intervalMs, DEFAULT_INTERVAL_MS);
  assert.equal(config.windowMs, DEFAULT_WINDOW_MS);
  assert.deepEqual(config.repos, []);
  assert.equal(config.issueScope, DEFAULT_ISSUE_SCOPE);
  assert.deepEqual(config.orgs, []);
  assert.equal(config.maxRepos, DEFAULT_MAX_REPOS);
  assert.equal(config.maxOrgs, DEFAULT_MAX_ORGS);
  assert.equal(config.maxResults, 100);
  assert.equal(config.maxPages, 3);
  assert.equal(config.includeDrafts, true);
  assert.equal(config.mentionMode, 'notifications');
  assert.equal(config.onStart, true);
  assert.equal(config.dataDir, '/home/tester/.dsh/dsh-github-message');
  assert.equal(config.stateFile, '/home/tester/.dsh/dsh-github-message/seen.json');
  assert.equal(config.runtimeConfigFile, '/home/tester/.dsh/dsh-github-message/config.json');
});

test('DSH_HOME 与 intervalMinutes 优先于默认值', () => {
  const config = resolveConfig({ intervalMinutes: 10 }, { env: { DSH_HOME: '/var/dsh' }, home: '/home/tester' });
  assert.equal(config.intervalMs, 600_000);
  assert.equal(config.dataDir, '/var/dsh/dsh-github-message');
});

test('周期有上下限，非法值回落到默认值', () => {
  assert.equal(resolveConfig({ intervalMs: 1_000 }, ENV).intervalMs, MIN_INTERVAL_MS);
  assert.equal(resolveConfig({ intervalMs: 30 * 24 * 60 * 60_000 }, ENV).intervalMs, MAX_INTERVAL_MS);

  const warnings: string[] = [];
  const config = resolveConfig({ intervalMs: 'soon' }, ENV, warnings);
  assert.equal(config.intervalMs, DEFAULT_INTERVAL_MS);
  assert.deepEqual(warnings, []);
});

test('windowMs 允许 0，负数降级并记 warning', () => {
  assert.equal(resolveConfig({ windowMs: 0 }, ENV).windowMs, 0);
  const warnings: string[] = [];
  const config = resolveConfig({ windowMs: -1 }, ENV, warnings);
  assert.equal(config.windowMs, DEFAULT_WINDOW_MS);
  assert.equal(warnings.length, 1);
});

test('仓库名校验、去重与上限', () => {
  assert.equal(normalizeRepo(' xbzbing/dsh-git-panel/ '), 'xbzbing/dsh-git-panel');
  assert.equal(normalizeRepo('no-slash'), undefined);
  assert.equal(normalizeRepo('a/b/c'), undefined);
  assert.equal(normalizeRepo(''), undefined);

  const warnings: string[] = [];
  const repos = parseRepos(['xbzbing/One', 'XBZBING/one', 'bad', 'owner/repo'], warnings);
  assert.deepEqual(repos, ['xbzbing/One', 'owner/repo']);
  assert.equal(warnings.length, 1);

  const many = Array.from({ length: 12 }, (_, index) => `owner/repo-${index}`);
  const limited = resolveConfig({ repos: many, maxRepos: 3 }, ENV, warnings);
  assert.deepEqual(limited.repos, many.slice(0, 3));
  assert.ok(warnings.some((warning) => warning.includes('maxRepos')));

  const capped = resolveConfig({ repos: many, maxRepos: 50 }, ENV);
  assert.equal(capped.maxRepos, 10);
  assert.equal(capped.repos.length, 10);
});

test('issueScope 与组织名校验、去重与上限', () => {
  assert.equal(normalizeOrg(' my-org '), 'my-org');
  assert.equal(normalizeOrg('a'), 'a');
  assert.equal(normalizeOrg('-bad'), undefined);
  assert.equal(normalizeOrg('bad-'), undefined);
  assert.equal(normalizeOrg('bad_org'), undefined);
  assert.equal(normalizeOrg(''), undefined);

  const warnings: string[] = [];
  const orgs = parseOrgs(['My-Org', 'my-org', 'bad_org', 'other'], warnings);
  assert.deepEqual(orgs, ['My-Org', 'other']);
  assert.equal(warnings.length, 1);

  assert.equal(resolveConfig({ issueScope: 'owned' }, ENV).issueScope, 'owned');
  assert.equal(resolveConfig({ issueScope: 'all' }, ENV, warnings).issueScope, DEFAULT_ISSUE_SCOPE);
  assert.ok(warnings.some((warning) => warning.includes('issueScope')));

  const many = Array.from({ length: 12 }, (_, index) => `org-${index}`);
  const limited = resolveConfig({ orgs: many, maxOrgs: 3 }, ENV, warnings);
  assert.deepEqual(limited.orgs, many.slice(0, 3));
  assert.ok(warnings.some((warning) => warning.includes('maxOrgs')));

  const capped = resolveConfig({ orgs: many, maxOrgs: 50 }, ENV);
  assert.equal(capped.maxOrgs, 10);
  assert.equal(capped.orgs.length, 10);
});

test('mentionMode 非法值降级，off/search 保留', () => {
  assert.equal(resolveConfig({ mentionMode: 'off' }, ENV).mentionMode, 'off');
  assert.equal(resolveConfig({ mentionMode: 'search' }, ENV).mentionMode, 'search');
  const warnings: string[] = [];
  assert.equal(resolveConfig({ mentionMode: 'webhook' }, ENV, warnings).mentionMode, 'notifications');
  assert.equal(warnings.length, 1);
});

test('stateFile/logFile/statsFile 可以显式关闭', () => {
  const config = resolveConfig({ stateFile: false, logFile: false, statsFile: false, runtimeConfigFile: false }, ENV);
  assert.equal(config.stateFile, undefined);
  assert.equal(config.logFile, undefined);
  assert.equal(config.statsFile, undefined);
  assert.equal(config.runtimeConfigFile, undefined);
});

test('cliPath 可由 DSH_GITHUB_CLI 覆盖', () => {
  assert.equal(resolveConfig({}, { env: { DSH_GITHUB_CLI: '/opt/gh' }, home: '/h' }).cliPath, '/opt/gh');
  assert.equal(resolveConfig({ cliPath: '/custom/gh' }, { env: { DSH_GITHUB_CLI: '/opt/gh' }, home: '/h' }).cliPath, '/custom/gh');
});
