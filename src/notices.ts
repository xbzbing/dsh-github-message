// 本地提示：没接入超级助理时，把采集到的事实转成一条可以弹窗的通知。
//
// 提示记录与 seen 分开存：提示过的事实不会写 seen，接入核心后仍会重新上报，
// 由核心决定要不要打扰主人。这样既能避免每轮重复弹窗，也不会吞掉真实信号。

import type { SignalDraft } from './signals.ts';

export interface NoticeItem {
  seq: number;
  id: string;
  kind: string;
  title: string;
  repo?: string;
  number?: number;
  url?: string;
  at: number;
}

export interface NoticeFeed {
  /** 当前是否处于本地提示模式（未接入核心）。 */
  enabled: boolean;
  /** 最新游标；客户端把它当 since 传回来。 */
  seq: number;
  /** 本次是否只做游标初始化（客户端首次调用不传 since）。 */
  initialized?: boolean;
  items: NoticeItem[];
}

/** 内存里最多留多少条，够面板和客户端补发即可。 */
export const MAX_NOTICES = 50;
/** 单次最多返回多少条，避免一次弹一屏。 */
export const MAX_NOTICE_BATCH = 5;

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/** 把信号草稿收敛成一条提示；标题只取已清洗过的 payload 字段。 */
export function noticeOf(draft: SignalDraft, seq: number): NoticeItem {
  const payload = draft.payload ?? {};
  const item: NoticeItem = {
    seq,
    id: draft.sourceEventId,
    kind: draft.kind,
    title: text(payload.title) ?? draft.summary,
    at: draft.occurredAt,
  };
  const repo = text(payload.repo);
  if (repo !== undefined) item.repo = repo;
  const number = count(payload.number);
  if (number !== undefined) item.number = number;
  const url = text(payload.url);
  if (url !== undefined) item.url = url;
  return item;
}
