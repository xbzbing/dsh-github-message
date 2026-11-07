import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { resolveConfig } from '../src/config.ts';
import { GhError, type GhRequest, type GhResponse, type GhTransport } from '../src/gh.ts';
import { createRpcRoute, handleRpc, RpcError } from '../src/rpc.ts';
import {
  GithubMessageRuntime,
  RuntimeConfigError,
  type SourceProviderLike,
  type SourceServiceLike,
} from '../src/runtime.ts';
import type { SignalDraft } from '../src/signals.ts';
import { SeenStore } from '../src/state.ts';

const NOW = Date.parse('2026-11-07T12:00:00Z');
const DAY = 24 * 60 * 60_000;

function tempDir(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-github-runtime-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function configOf(dir: string) {
  return resolveConfig({
    dataDir: dir,
    intervalMs: 60_000,
    onStart: false,
    stateFile: false,
    logFile: false,
    statsFile: join(dir, 'stats.json'),
    runtimeConfigFile: join(dir, 'config.json'),
    windowMs: DAY,
    repos: [],
  }, { env: {}, home: dir });
}

const AUTH_OK = JSON.stringify({
  hosts: { 'github.com': [{ state: 'success', active: true, login: 'alice', tokenSource: 'keyring', scopes: 'repo' }] },
});

class FakeTransport implements GhTransport {
  readonly calls: GhRequest[] = [];
  private readonly handler: (request: GhRequest) => GhResponse | Promise<GhResponse>;
  execResult: string | Error = AUTH_OK;

  constructor(handler?: (request: GhRequest) => GhResponse | Promise<GhResponse>) {
    this.handler = handler ?? ((request) => {
      if (request.endpoint === 'search/issues') {
        return { status: 200, headers: {}, body: '{"total_count":0,"items":[]}' };
      }
      if (request.endpoint === 'user') return { status: 200, headers: {}, body: '{"login":"alice"}' };
      return { status: 200, headers: {}, body: '[]' };
    });
  }

  async api(request: GhRequest): Promise<GhResponse> {
    this.calls.push(request);
    return this.handler(request);
  }

  async exec(args: string[]): Promise<string> {
    void args;
    if (this.execResult instanceof Error) throw this.execResult;
    return this.execResult;
  }
}

interface FakeService {
  service: SourceServiceLike;
  drafts: SignalDraft[];
  provider(): SourceProviderLike | undefined;
  disposed(): number;
}

function fakeService(features: string[], emitResult?: () => { accepted: false; reason: string }): FakeService {
  const drafts: SignalDraft[] = [];
  let registered: SourceProviderLike | undefined;
  let disposed = 0;
  const service: SourceServiceLike = {
    protocol: { versions: ['my-superagent/v1'], features },
    sources: {
      register(provider) {
        registered = provider;
        return {
          id: provider.id,
          async emit(draft) {
            drafts.push(draft);
            return emitResult?.() ?? { accepted: true as const, id: `id-${drafts.length}`, duplicate: false };
          },
          dispose() {
            disposed += 1;
          },
        };
      },
    },
  };
  return { service, drafts, provider: () => registered, disposed: () => disposed };
}

function runtimeOf(dir: string, transport: FakeTransport): GithubMessageRuntime {
  return new GithubMessageRuntime({
    config: configOf(dir),
    logger: {},
    now: () => NOW,
    client: transport,
    seen: SeenStore.open({ file: undefined, ttlMs: DAY, maxEntries: 10, now: NOW }),
    reminders: () => ({ available: false, total: 0, byState: {}, byKind: {}, code: 'db-missing', note: 'test' }),
  });
}

function reviewHandler(sha = 'a'.repeat(40)) {
  return (request: GhRequest): GhResponse => {
    if (request.endpoint === 'notifications') return { status: 200, headers: {}, body: '[]' };
    if (request.endpoint === 'user') return { status: 200, headers: {}, body: '{"login":"alice"}' };
    if (request.endpoint === 'search/issues') {
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          total_count: 1,
          items: [{
            number: 42,
            title: 'PR',
            html_url: 'https://github.com/o/r/pull/42',
            repository_url: 'https://api.github.com/repos/o/r',
            updated_at: '2026-11-07T08:00:00Z',
            user: { login: 'bob' },
            pull_request: { merged_at: null },
          }],
        }),
      };
    }
    return {
      status: 200,
      headers: {},
      body: JSON.stringify({
        state: 'open',
        merged: false,
        draft: false,
        updated_at: '2026-11-07T08:00:00Z',
        title: 'PR',
        html_url: 'https://github.com/o/r/pull/42',
        user: { login: 'bob' },
        head: { sha },
        base: { ref: 'main' },
      }),
    };
  };
}

test('注册来源：external 信任、三种 kind、feature 探测', async (t) => {
  const dir = tempDir(t);
  const runtime = runtimeOf(dir, new FakeTransport());
  const fake = fakeService(['github-source']);
  try {
    runtime.attach(fake.service);
    const provider = fake.provider();
    assert.equal(provider?.id, 'github-message');
    assert.deepEqual(provider?.protocol, ['my-superagent/v1']);
    assert.deepEqual(provider?.kinds, ['code-review.requested', 'github.issue.opened', 'github.mention']);
    assert.equal(provider?.trust, 'external');

    const status = runtime.status();
    assert.equal(status.source.registered, true);
    assert.equal(status.source.featureSupported, true);
    assert.equal(status.source.state, 'running');
    assert.equal(status.source.requiredFeature, 'github-source');
  } finally {
    runtime.detach();
  }
  assert.equal(fake.disposed(), 1);
});

test('核心缺 github-source 时进入 dryRun，不 emit、不写 seen', async (t) => {
  const dir = tempDir(t);
  const runtime = runtimeOf(dir, new FakeTransport(reviewHandler()));
  const fake = fakeService([]);
  try {
    runtime.attach(fake.service);
    assert.equal(runtime.status().source.state, 'dry-run');
    await runtime.pollNow();
    assert.equal(fake.drafts.length, 0);
    assert.equal(runtime.status().stats.deferred, 1);
    assert.equal(runtime.status().stats.emitted, 0);
  } finally {
    runtime.detach();
  }
});

test('轮询成功后更新统计与登录态，来源关闭时进入 waiting', async (t) => {
  const dir = tempDir(t);
  const transport = new FakeTransport(reviewHandler());
  const runtime = runtimeOf(dir, transport);
  const fake = fakeService(['github-source']);
  try {
    runtime.attach(fake.service);
    await runtime.pollNow();
    const status = runtime.status();
    assert.equal(fake.drafts.length, 1);
    assert.equal(status.stats.polls, 1);
    assert.equal(status.stats.emitted, 1);
    assert.equal(status.stats.byKind.review.emitted, 1);
    assert.equal(status.login.api, 'ok');
    assert.equal(status.login.username, 'alice');
    assert.equal(status.poll.running, false);
    assert.ok((status.poll.nextPollAt ?? 0) > NOW);

    runtime.resetStats();
    assert.equal(runtime.status().stats.polls, 0);
  } finally {
    runtime.detach();
  }

  const disabled = new FakeTransport(reviewHandler());
  const closed = runtimeOf(dir, disabled);
  const closedService = fakeService(['github-source'], () => ({ accepted: false, reason: 'source-disabled' }));
  try {
    closed.attach(closedService.service);
    await closed.pollNow();
    assert.equal(closed.status().source.state, 'waiting');
    assert.equal(closed.status().stats.deferred, 1);
  } finally {
    closed.detach();
  }
});

test('setConfig 保存周期与仓库，校验非法值', async (t) => {
  const dir = tempDir(t);
  const runtime = runtimeOf(dir, new FakeTransport());
  const fake = fakeService(['github-source']);
  try {
    runtime.attach(fake.service);
    const status = runtime.setConfig({ intervalMs: 120_000, repos: ['o/r', 'O/R', 'o/two'] });
    assert.equal(status.config.intervalMs, 120_000);
    assert.deepEqual(status.config.repos, ['o/r', 'o/two']);
    const saved = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as { intervalMs?: number; repos?: string[] };
    assert.equal(saved.intervalMs, 120_000);
    assert.deepEqual(saved.repos, ['o/r', 'o/two']);

    runtime.setConfig({ intervalMs: 180_000 });
    const afterInterval = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as { intervalMs?: number; repos?: string[] };
    assert.equal(afterInterval.intervalMs, 180_000);
    assert.deepEqual(afterInterval.repos, ['o/r', 'o/two']);

    runtime.setConfig({ repos: ['o/three'] });
    const afterRepos = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as { intervalMs?: number; repos?: string[] };
    assert.equal(afterRepos.intervalMs, 180_000);
    assert.deepEqual(afterRepos.repos, ['o/three']);

    assert.equal(runtime.setConfig({ intervalMs: 1_000 }).config.intervalMs, 60_000);
    assert.throws(() => runtime.setConfig({ intervalMs: 'soon' }), RuntimeConfigError);
    assert.throws(() => runtime.setConfig({ repos: ['bad'] }), RuntimeConfigError);
    assert.throws(() => runtime.setConfig({ repos: 'o/r' }), RuntimeConfigError);
  } finally {
    runtime.detach();
  }
});

test('缺少 notifications scope 时自动降级 search', async (t) => {
  const dir = tempDir(t);
  const transport = new FakeTransport((request) => {
    if (request.endpoint === 'search/issues') {
      return { status: 200, headers: {}, body: '{"total_count":0,"items":[]}' };
    }
    if (request.endpoint === 'user') return { status: 200, headers: {}, body: '{"login":"alice"}' };
    throw new Error(`unexpected ${request.endpoint}`);
  });
  transport.execResult = JSON.stringify({
    hosts: { 'github.com': [{ state: 'success', active: true, login: 'alice', scopes: 'gist' }] },
  });
  const runtime = runtimeOf(dir, transport);
  const fake = fakeService(['github-source']);
  try {
    runtime.attach(fake.service);
    await runtime.pollNow();
    assert.equal(runtime.status().config.effectiveMentionMode, 'search');
    assert.equal(transport.calls.some((call) => call.endpoint === 'notifications'), false);
    assert.ok(transport.calls.some((call) => String(call.params?.q).startsWith('mentions:@me')));
  } finally {
    runtime.detach();
  }
});

test('checkLogin 更新账号与 API 状态', async (t) => {
  const dir = tempDir(t);
  const transport = new FakeTransport(() => ({ status: 200, headers: {}, body: '{"login":"alice"}' }));
  const runtime = runtimeOf(dir, transport);
  const fake = fakeService(['github-source']);
  try {
    runtime.attach(fake.service);
    const login = await runtime.checkLogin();
    assert.equal(login.authenticated, true);
    assert.equal(login.api, 'ok');
    assert.equal(login.username, 'alice');
    assert.equal(runtime.status().login.username, 'alice');
  } finally {
    runtime.detach();
  }
});

test('失败退避与限流重置进入下一轮时间', async (t) => {
  const dir = tempDir(t);
  const reset = NOW + 30 * 60_000;
  const transport = new FakeTransport((request) => {
    if (request.endpoint === 'notifications') throw new GhError('rate-limited', 'rate limit', undefined, reset);
    if (request.endpoint === 'search/issues') throw new GhError('network', 'network down');
    throw new Error('unexpected');
  });
  const runtime = runtimeOf(dir, transport);
  const fake = fakeService(['github-source']);
  try {
    runtime.attach(fake.service);
    await runtime.pollNow();
    const first = runtime.status();
    assert.ok(first.poll.backoffMs >= 60_000);
    assert.ok((first.poll.nextPollAt ?? 0) >= reset);
  } finally {
    runtime.detach();
  }
});

test('RPC 信封：status/config.set/未知方法', async (t) => {
  const dir = tempDir(t);
  const runtime = runtimeOf(dir, new FakeTransport());
  const fake = fakeService(['github-source']);
  const route = createRpcRoute(runtime, () => {});
  try {
    runtime.attach(fake.service);
    const ok = await route.fetch(new Request('http://localhost/api/dsh-github-message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: 'r1',
        method: 'dsh-github-message',
        payload: { method: 'status', payload: {} },
      }),
    }));
    assert.equal(ok.status, 200);
    const body = await ok.json() as { result?: { ok?: boolean; value?: { contractVersion?: number } } };
    assert.equal(body.result?.ok, true);
    assert.equal(body.result?.value?.contractVersion, 1);

    const saved = await handleRpc(runtime, 'config.set', { intervalMs: 120_000 }) as { config?: { intervalMs?: number } };
    assert.equal(saved.config?.intervalMs, 120_000);

    await assert.rejects(
      () => handleRpc(runtime, 'nope', {}),
      (error: unknown) => error instanceof RpcError && error.code === 'unknown-method',
    );

    const wrongType = await route.fetch(new Request('http://localhost/api/dsh-github-message', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    }));
    assert.equal(wrongType.status, 415);
  } finally {
    runtime.detach();
  }
});
