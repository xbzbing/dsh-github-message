// 面板到 host 的 RPC：经宿主 Connection 发到 /api/dsh-github-message。

import { RPC_PATH } from '../constants.ts';

const RPC_TIMEOUT_MS = 20_000;

export class PanelError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PanelError';
    this.code = code;
  }
}

export interface Connection {
  rpc?: {
    call(base: string, method: string, payload: unknown, signal: AbortSignal): Promise<unknown>;
  };
}

export type RpcCall = <T>(method: string, payload?: unknown) => Promise<T>;

export function unwrapResult(raw: unknown): unknown {
  const outer = raw as { result?: unknown } | null;
  const result = (outer && typeof outer === 'object' && outer.result && typeof outer.result === 'object' ? outer.result : raw) as
    | { ok?: unknown; value?: unknown; error?: { code?: unknown; message?: unknown } }
    | null;
  if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') {
    throw new PanelError('invalid-response', '宿主返回了无法识别的响应');
  }
  if (!result.ok) {
    const message = typeof result.error?.message === 'string' && result.error.message ? result.error.message : '操作失败';
    throw new PanelError(typeof result.error?.code === 'string' ? result.error.code : 'rpc-failed', message);
  }
  return result.value;
}

export function createRpcCall(connection: Connection | undefined): RpcCall {
  return async <T>(method: string, payload: unknown = {}): Promise<T> => {
    const rpc = connection?.rpc;
    if (!rpc || typeof rpc.call !== 'function') throw new PanelError('connection-unavailable', '当前页面没有可用的 Host 连接');
    const raw = await rpc.call('/api', RPC_PATH, { method, payload }, AbortSignal.timeout(RPC_TIMEOUT_MS));
    return unwrapResult(raw) as T;
  };
}
