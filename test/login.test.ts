import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GhError, type GhRequest, type GhResponse, type GhTransport } from '../src/gh.ts';
import {
  hasNotificationsScope,
  initialLogin,
  loginFromPoll,
  parseAuthStatus,
  parseUserLogin,
  probeLogin,
} from '../src/login.ts';
import type { PollSummary } from '../src/poller.ts';

const AUTH_OK = JSON.stringify({
  hosts: {
    'github.com': [{
      state: 'success',
      active: true,
      host: 'github.com',
      login: 'xbzbing',
      tokenSource: 'keyring',
      scopes: 'gist, read:org, repo',
      gitProtocol: 'ssh',
    }],
  },
});

class FakeTransport implements GhTransport {
  readonly execCalls: string[][] = [];
  readonly apiCalls: GhRequest[] = [];
  private readonly execResult: string | Error;
  private readonly apiResult: GhResponse | Error;

  constructor(execResult: string | Error, apiResult: GhResponse | Error) {
    this.execResult = execResult;
    this.apiResult = apiResult;
  }

  async exec(args: string[]): Promise<string> {
    this.execCalls.push(args);
    if (this.execResult instanceof Error) throw this.execResult;
    return this.execResult;
  }

  async api(request: GhRequest): Promise<GhResponse> {
    this.apiCalls.push(request);
    if (this.apiResult instanceof Error) throw this.apiResult;
    return this.apiResult;
  }
}

function userResponse(): GhResponse {
  return { status: 200, headers: {}, body: JSON.stringify({ login: 'xbzbing' }) };
}

test('解析 gh auth status 的当前账号与 scopes', () => {
  const parsed = parseAuthStatus(AUTH_OK);
  assert.equal(parsed.authenticated, true);
  assert.equal(parsed.username, 'xbzbing');
  assert.equal(parsed.tokenSource, 'keyring');
  assert.deepEqual(parsed.scopes, ['gist', 'read:org', 'repo']);
  assert.equal(hasNotificationsScope(parsed.scopes), 'ok');

  assert.equal(parseAuthStatus('not json').authenticated, false);
  assert.equal(parseAuthStatus('{"hosts":{}}').authenticated, false);
  assert.equal(parseUserLogin('{"login":"alice"}'), 'alice');
  assert.equal(parseUserLogin('bad'), undefined);
});

test('有 repo 或 notifications scope 即可读通知', () => {
  assert.equal(hasNotificationsScope(['repo']), 'ok');
  assert.equal(hasNotificationsScope(['notifications']), 'ok');
  assert.equal(hasNotificationsScope(['gist']), 'missing');
  assert.equal(hasNotificationsScope([]), 'unknown');
});

test('登录正常时探测 API 并补全账号', async () => {
  const transport = new FakeTransport(AUTH_OK, userResponse());
  const snapshot = await probeLogin(transport, 5_000);
  assert.equal(snapshot.installed, true);
  assert.equal(snapshot.authenticated, true);
  assert.equal(snapshot.api, 'ok');
  assert.equal(snapshot.username, 'xbzbing');
  assert.equal(snapshot.notifications, 'ok');
  assert.equal(snapshot.reason, undefined);
  assert.deepEqual(transport.execCalls[0], ['auth', 'status', '--json', 'hosts']);
  assert.deepEqual(transport.apiCalls[0], { endpoint: 'user' });
});

test('未登录、gh 缺失、API 失效分别给出原因', async () => {
  const notLoggedIn = new FakeTransport(
    new GhError('other', 'You are not logged into any GitHub hosts'),
    userResponse(),
  );
  const snapshot = await probeLogin(notLoggedIn, 5_000);
  assert.equal(snapshot.installed, true);
  assert.equal(snapshot.authenticated, false);
  assert.equal(snapshot.reason, 'not-logged-in');

  const missing = new FakeTransport(new GhError('not-installed', '找不到 gh'), userResponse());
  const missingSnapshot = await probeLogin(missing, 5_000);
  assert.equal(missingSnapshot.installed, false);
  assert.equal(missingSnapshot.reason, 'gh-missing');

  const expired = new FakeTransport(AUTH_OK, new GhError('unauthenticated', 'Bad credentials', 401));
  const expiredSnapshot = await probeLogin(expired, 5_000);
  assert.equal(expiredSnapshot.authenticated, true);
  assert.equal(expiredSnapshot.api, 'expired');
  assert.equal(expiredSnapshot.reason, 'credential');

  const network = new FakeTransport(AUTH_OK, new GhError('network', 'network down'));
  const networkSnapshot = await probeLogin(network, 5_000);
  assert.equal(networkSnapshot.api, 'error');
  assert.equal(networkSnapshot.reason, 'network');
});

function summary(overrides: Partial<PollSummary> = {}): PollSummary {
  const stream = () => ({
    fetched: 0, emitted: 0, duplicates: 0, filtered: 0, skipped: 0, deferred: 0,
    errors: [] as string[], authenticated: true,
  });
  return {
    at: 1_000,
    review: stream(),
    issue: stream(),
    mention: stream(),
    selfPr: stream(),
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
    dryRun: false,
    ...overrides,
  };
}

test('轮询结果修正登录态', () => {
  const previous = initialLogin();
  const ok = loginFromPoll(previous, summary({ at: 2_000 }));
  assert.equal(ok.api, 'ok');
  assert.equal(ok.authenticated, true);
  assert.equal(ok.checkedAt, 2_000);

  const expired = loginFromPoll(previous, summary({ at: 3_000, authenticated: false, errors: ['Bad credentials'] }));
  assert.equal(expired.api, 'expired');
  assert.equal(expired.authenticated, false);
  assert.equal(expired.reason, 'credential');
});
