// 测试用的 gh 传输层：记录调用，按 endpoint 返回预设响应，不启动子进程。

import type { GhRequest, GhResponse, GhTransport } from '../../src/gh.ts';

export type FakeHandler = (request: GhRequest) => GhResponse | Promise<GhResponse>;

export class FakeGh implements GhTransport {
  readonly calls: GhRequest[] = [];
  private readonly handler: FakeHandler;

  constructor(handler: FakeHandler) {
    this.handler = handler;
  }

  async api(request: GhRequest, _timeoutMs: number): Promise<GhResponse> {
    this.calls.push(request);
    return this.handler(request);
  }

  async exec(args: string[], _timeoutMs: number): Promise<string> {
    void args;
    return '';
  }
}

export function jsonResponse(data: unknown, headers: Record<string, string> = {}): GhResponse {
  return { status: 200, headers, body: JSON.stringify(data) };
}

export function notModified(headers: Record<string, string> = { etag: '"v1"' }): GhResponse {
  return { status: 304, headers, body: '' };
}

export function searchPage(items: unknown[]): GhResponse {
  return jsonResponse({ total_count: items.length, incomplete_results: false, items });
}

export function prSearchItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 42,
    title: 'Add GitHub source',
    html_url: 'https://github.com/xbzbing/dsh-my-superagent/pull/42',
    repository_url: 'https://api.github.com/repos/xbzbing/dsh-my-superagent',
    updated_at: '2026-11-07T08:00:00Z',
    created_at: '2026-11-06T08:00:00Z',
    user: { login: 'alice' },
    draft: false,
    pull_request: { merged_at: null },
    ...overrides,
  };
}

export function prDetail(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 42,
    title: 'Add GitHub source',
    html_url: 'https://github.com/xbzbing/dsh-my-superagent/pull/42',
    state: 'open',
    merged: false,
    draft: false,
    updated_at: '2026-11-07T08:00:00Z',
    user: { login: 'alice' },
    head: { sha: 'a'.repeat(40), ref: 'feature/github' },
    base: { ref: 'main' },
    ...overrides,
  };
}

export function issueSearchItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 7,
    title: 'GitHub source 需要支持团队 @',
    html_url: 'https://github.com/xbzbing/dsh-my-superagent/issues/7',
    repository_url: 'https://api.github.com/repos/xbzbing/dsh-my-superagent',
    updated_at: '2026-11-07T08:00:00Z',
    created_at: '2026-11-07T08:00:00Z',
    user: { login: 'bob' },
    labels: [{ name: 'enhancement' }],
    ...overrides,
  };
}
