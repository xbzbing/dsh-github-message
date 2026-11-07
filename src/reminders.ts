// 超级助理信号统计：只读打开 dsh-my-superagent 的 SQLite，读不到就降级。
// 核心支持 github-source 之前，外部来源信号会停在 state='new' 或 'ignored'。

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type CoreSignalCode = 'ok' | 'empty' | 'db-missing' | 'read-failed';

export interface CoreSignalStats {
  available: boolean;
  total: number;
  byState: Record<string, number>;
  byKind: Record<string, Record<string, number>>;
  code: CoreSignalCode;
  detail?: string;
  note: string;
}

export function coreStatePath(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const dshHome = env.DSH_HOME !== undefined && env.DSH_HOME !== '' ? env.DSH_HOME : join(home, '.dsh');
  return join(dshHome, 'dsh-my-superagent', 'state.sqlite');
}

export function readCoreSignals(
  source: string,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): CoreSignalStats {
  const file = coreStatePath(env, home);
  if (!existsSync(file)) {
    return {
      available: false,
      total: 0,
      byState: {},
      byKind: {},
      code: 'db-missing',
      note: '未找到超级助理数据库（dsh-my-superagent 未安装或尚未启动）',
    };
  }
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const rows = db.prepare(
        'SELECT kind, state, COUNT(*) AS n FROM signals WHERE source = ? GROUP BY kind, state',
      ).all(source) as { kind: string; state: string; n: number }[];
      const byState: Record<string, number> = {};
      const byKind: Record<string, Record<string, number>> = {};
      let total = 0;
      for (const row of rows) {
        const amount = Number(row.n);
        if (!Number.isFinite(amount)) continue;
        total += amount;
        byState[row.state] = (byState[row.state] ?? 0) + amount;
        byKind[row.kind] ??= {};
        byKind[row.kind][row.state] = amount;
      }
      return {
        available: true,
        total,
        byState,
        byKind,
        code: total === 0 ? 'empty' : 'ok',
        note: total === 0
          ? '还没有落库信号'
          : 'ignored 表示核心尚未回源确认；admitted/digested 才会进入通知链路',
      };
    } finally {
      db.close();
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      available: false,
      total: 0,
      byState: {},
      byKind: {},
      code: 'read-failed',
      detail,
      note: `读取超级助理信号失败：${detail}`,
    };
  }
}
