// 面板横幅提示的生命周期：操作成功的提示 5 秒后自动消失，
// 失败提示留给用户读完再手动关闭。纯数据 + 纯函数，不依赖 React，方便单独测试。

export type NoticeTone = 'info' | 'error';

/** 成功提示的停留时长。 */
export const NOTICE_DISMISS_MS = 5_000;

export interface Notice {
  /** 自增序号：同样文案再次出现时也能重新计时、重新渲染。 */
  id: number;
  text: string;
  tone: NoticeTone;
  /** 自动消失的时刻；undefined 表示只能手动关闭。 */
  expiresAt?: number;
}

export function createNotice(id: number, text: string, tone: NoticeTone, now: number): Notice {
  return tone === 'info'
    ? { id, text, tone, expiresAt: now + NOTICE_DISMISS_MS }
    : { id, text, tone };
}

/** 距离自动消失还有多少毫秒；返回 undefined 表示不会自动消失。 */
export function dismissInMs(notice: Notice, now: number): number | undefined {
  if (notice.expiresAt === undefined) return undefined;
  return Math.max(0, notice.expiresAt - now);
}
