import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  apiArgs,
  buildEndpoint,
  classifyGhFailure,
  createRunner,
  GhError,
  minimalEnv,
  parseGhResponse,
} from '../src/gh.ts';

test('最小环境不传 token 与 DSH 变量', () => {
  const env = minimalEnv({
    HOME: '/home/me',
    PATH: '/usr/bin',
    GH_TOKEN: 'secret',
    GITHUB_TOKEN: 'secret',
    DSH_HOME: '/dsh',
    LANG: 'zh_CN.UTF-8',
  });
  assert.deepEqual(env, { HOME: '/home/me', PATH: '/usr/bin', LANG: 'zh_CN.UTF-8' });
});

test('query 参数编码与 gh argv', () => {
  assert.equal(buildEndpoint('search/issues'), 'search/issues');
  const endpoint = buildEndpoint('search/issues', { q: 'is:pr review-requested:@me', per_page: 50, page: 1, skip: undefined });
  assert.equal(endpoint, 'search/issues?q=is%3Apr+review-requested%3A%40me&per_page=50&page=1');

  assert.deepEqual(apiArgs({ endpoint: 'notifications', params: { all: true } }), ['api', '--include', 'notifications?all=true']);
  assert.deepEqual(apiArgs({ endpoint: 'repos/a/b/pulls/1', headers: { 'If-None-Match': 'W/"x"' } }), [
    'api', '--include', '-H', 'If-None-Match: W/"x"', 'repos/a/b/pulls/1',
  ]);
});

test('解析 --include 响应：状态、头、body', () => {
  const response = parseGhResponse([
    'HTTP/2.0 200 OK',
    'Etag: W/"abc"',
    'X-Poll-Interval: 60',
    '',
    '{"ok":true}',
  ].join('\r\n'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.etag, 'W/"abc"');
  assert.equal(response.headers['x-poll-interval'], '60');
  assert.equal(response.body, '{"ok":true}');
});

test('304 只有响应头也能解析', () => {
  const response = parseGhResponse('HTTP/2.0 304 Not Modified\r\nEtag: "abc"\r\n\r\n');
  assert.equal(response.status, 304);
  assert.equal(response.body, '');
});

test('非 HTTP 输出归类为 invalid-output', () => {
  assert.throws(
    () => parseGhResponse('not a response'),
    (error: unknown) => error instanceof GhError && error.kind === 'invalid-output',
  );
});

test('错误分类覆盖认证、404、限流、网络', () => {
  assert.equal(classifyGhFailure('gh: Bad credentials (HTTP 401)', 1).kind, 'unauthenticated');
  assert.equal(classifyGhFailure('gh: Not Found (HTTP 404)', 1).kind, 'not-found');
  assert.equal(classifyGhFailure('gh: API rate limit exceeded for user (HTTP 403)', 1).kind, 'rate-limited');
  assert.equal(classifyGhFailure('gh: slow down (HTTP 429)', 1).kind, 'rate-limited');
  assert.equal(classifyGhFailure('gh: API rate limit exceeded', 1).kind, 'rate-limited');
  assert.equal(classifyGhFailure('gh: Could not resolve host: api.github.com', 1).kind, 'network');
  assert.equal(classifyGhFailure('something odd', 2).kind, 'other');
});

test('runner 把非零退出转成 GhError，缺失命令转成 not-installed', async () => {
  const runner = createRunner(process.execPath);
  await assert.rejects(
    () => runner.run(['-e', 'process.exit(3)'], 5_000),
    (error: unknown) => error instanceof GhError && error.kind === 'other',
  );
  const missing = createRunner('/definitely/not/a/gh');
  await assert.rejects(
    () => missing.run(['--version'], 5_000),
    (error: unknown) => error instanceof GhError && error.kind === 'not-installed',
  );
});

test('runner 输出超限时拒绝而不是静默截断', async () => {
  const runner = createRunner(process.execPath);
  await assert.rejects(
    () => runner.run(['-e', "process.stdout.write('x'.repeat(9 * 1024 * 1024))"], 20_000),
    (error: unknown) => error instanceof GhError && error.kind === 'invalid-output',
  );
});

test('runner 超时会杀掉子进程', async () => {
  const runner = createRunner(process.execPath);
  await assert.rejects(
    () => runner.run(['-e', 'setTimeout(() => {}, 5000)'], 100),
    (error: unknown) => error instanceof GhError && error.kind === 'timeout',
  );
});
