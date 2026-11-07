// 面板 RPC 路由：POST /api/dsh-github-message，信封与宿主 Connection 客户端一致。

import { RPC_PATH } from './constants.ts';
import { RuntimeConfigError, type GithubMessageRuntime } from './runtime.ts';

const MAX_BODY = 256 * 1024;

export interface PanelRoute {
  path: string;
  methods: string[];
  requestBody: 'buffered';
  fetch(request: Request): Promise<Response>;
}

export class RpcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
  }
}

interface Envelope {
  type?: unknown;
  rpcId?: unknown;
  method?: unknown;
  payload?: { method?: unknown; payload?: unknown };
}

function reply(rpcId: string, result: unknown): Response {
  return Response.json({ type: 'server-response', rpcId, result });
}

function failure(rpcId: string, code: string, message: string): Response {
  return reply(rpcId, { ok: false, error: { code, message, details: {} } });
}

export async function handleRpc(
  runtime: GithubMessageRuntime,
  method: string,
  payload: unknown,
): Promise<unknown> {
  switch (method) {
    case 'status':
      return runtime.status();
    case 'config.set':
      return runtime.setConfig(payload);
    case 'login.check':
      await runtime.checkLogin();
      return runtime.status();
    case 'poll.now':
      await runtime.pollNow(true);
      return runtime.status();
    case 'notices': {
      const input = payload !== null && typeof payload === 'object' && !Array.isArray(payload)
        ? payload as Record<string, unknown>
        : {};
      return runtime.notices(input.since);
    }
    case 'stats.reset':
      runtime.resetStats();
      return runtime.status();
    default:
      throw new RpcError('unknown-method', `未知的面板操作 ${method}`);
  }
}

function isPublic(error: unknown): error is { code: string; message: string } {
  return error instanceof RpcError || error instanceof RuntimeConfigError;
}

export function createRpcRoute(
  runtime: GithubMessageRuntime,
  onError: (method: string, error: unknown) => void,
): PanelRoute {
  return {
    path: `/api/${RPC_PATH}`,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request: Request): Promise<Response> {
      if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
      const type = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
      if (type !== 'application/json') return new Response('content type must be application/json', { status: 415 });
      const text = await request.text();
      if (text.length > MAX_BODY) return new Response('body too large', { status: 413 });
      let envelope: Envelope | null;
      try {
        envelope = JSON.parse(text) as Envelope | null;
      } catch {
        return new Response('body is not JSON', { status: 400 });
      }
      const rpcId = typeof envelope?.rpcId === 'string' ? envelope.rpcId : 'invalid-request';
      const call = envelope?.payload;
      if (envelope?.type !== 'client-request' || envelope.method !== RPC_PATH || typeof call?.method !== 'string') {
        return failure(rpcId, 'bad-request', '请求格式不合法');
      }
      try {
        return reply(rpcId, { ok: true, value: await handleRpc(runtime, call.method, call.payload) });
      } catch (error) {
        onError(call.method, error);
        return isPublic(error)
          ? failure(rpcId, error.code, error.message)
          : failure(rpcId, 'internal', '操作失败，详情见日志');
      }
    },
  };
}
