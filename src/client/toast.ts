// 右下角本地提示：只在没有接入超级助理时出现，已接入由核心接管通知。
// 组件挂在 shell.overlay 上，所以不打开设置页也能看到。

import * as React from 'react';

import type { NoticeFeed, NoticeItem } from '../notices.ts';
import type { Translate } from './locale.ts';
import type { RpcCall } from './rpc.ts';
import { kindLabel } from './views.ts';

const { useEffect, useRef, useState } = React;
const h = React.createElement as unknown as (
  type: unknown,
  props?: Record<string, unknown> | null,
  ...children: unknown[]
) => unknown;

/** 本地提示模式下的轮询间隔；接入核心后放慢，只是等状态变化。 */
const ACTIVE_INTERVAL_MS = 5_000;
const IDLE_INTERVAL_MS = 30_000;
const AUTO_DISMISS_MS = 12_000;
const MAX_VISIBLE = 4;
const STYLE_ID = 'dgm-toast-styles';

interface Props {
  t: Translate;
  rpcCall: RpcCall;
  [key: string]: unknown;
}

interface Entry {
  item: NoticeItem;
  until: number;
}

const STYLES = `
.dgm-toasts{position:fixed;right:18px;bottom:18px;z-index:2147483000;display:flex;flex-direction:column;gap:10px;width:min(340px,calc(100vw - 36px));pointer-events:none}
.dgm-toast{pointer-events:auto;display:flex;flex-direction:column;gap:6px;padding:11px 13px 12px;border:1px solid var(--dsw-alias-border-primary,rgba(100,116,139,.22));border-left:3px solid var(--dsw-alias-brand-primary,#246bce);border-radius:11px;background:var(--dsw-alias-bg-primary,#fff);color:var(--dsw-alias-text-primary,#182230);box-shadow:0 10px 30px rgba(15,23,42,.16);animation:dgm-toast-in .16s ease-out}
.dgm-toast[data-kind="code-review.requested"]{border-left-color:#7c5cd6}
.dgm-toast[data-kind="github.issue.opened"]{border-left-color:#2f9e6b}
.dgm-toast[data-kind="github.mention"]{border-left-color:#d08a1f}
.dgm-toast[data-kind="github.pr.opened"]{border-left-color:#3a7bd5}
.dgm-toast-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dgm-toast-kind{font-size:11px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-text-tertiary,#718096)}
.dgm-toast-close{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-text-tertiary,#718096);font:inherit;font-size:15px;line-height:1;cursor:pointer}
.dgm-toast-close:hover{background:var(--dsw-alias-bg-secondary,#f1f3f6);color:var(--dsw-alias-text-primary,#182230)}
.dgm-toast-close:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#246bce);outline-offset:1px}
.dgm-toast-title{margin:0;font-size:13px;font-weight:600;line-height:1.45;color:inherit;text-decoration:none;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
a.dgm-toast-title:hover{text-decoration:underline}
.dgm-toast-meta{font-size:11px;line-height:1.5;color:var(--dsw-alias-text-tertiary,#718096);font-variant-numeric:tabular-nums}
@keyframes dgm-toast-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@media (max-width:640px){.dgm-toasts{right:12px;bottom:12px;width:calc(100vw - 24px)}}
@media (prefers-reduced-motion:reduce){.dgm-toast{animation:none}}
`;

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}

function clockOf(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return '';
  return new Date(at).toLocaleTimeString();
}

function metaOf(t: Translate, item: NoticeItem): string {
  const where = item.repo === undefined
    ? ''
    : item.number === undefined ? item.repo : `${item.repo} #${item.number}`;
  const time = clockOf(item.at);
  if (where === '') return time === '' ? t('未接入超级助理') : time;
  return time === '' ? where : `${where} · ${time}`;
}

export function NoticeToasts(props: Props): unknown {
  const { t, rpcCall } = props;
  ensureStyles();

  const [entries, setEntries] = useState<Entry[]>([]);
  const cursor = useRef<number | undefined>(undefined);
  const alive = useRef(true);

  const dismiss = (seq: number): void => {
    setEntries((current) => current.filter((entry) => entry.item.seq !== seq));
  };

  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = ACTIVE_INTERVAL_MS;

    const tick = async (): Promise<void> => {
      try {
        const since = cursor.current;
        const feed = await rpcCall<NoticeFeed>('notices', since === undefined ? {} : { since });
        if (!alive.current) return;
        if (since === undefined || feed.seq < since) {
          // 首次只拿游标，避免打开页面时把历史积压一次弹出来。
          cursor.current = feed.seq;
        } else if (feed.items.length > 0) {
          cursor.current = feed.seq;
          const now = Date.now();
          setEntries((current) => [
            ...current,
            ...feed.items.map((item) => ({ item, until: now + AUTO_DISMISS_MS })),
          ].slice(-MAX_VISIBLE));
        } else {
          cursor.current = feed.seq;
        }
        delay = feed.enabled ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS;
      } catch {
        // host 还没准备好或页面刚刷新：退到慢速重试，不打扰用户。
        delay = IDLE_INTERVAL_MS;
      }
      if (alive.current) timer = setTimeout(() => void tick(), delay);
    };

    void tick();
    return () => {
      alive.current = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [rpcCall]);

  useEffect(() => {
    if (entries.length === 0) return undefined;
    const timer = setInterval(() => {
      const now = Date.now();
      setEntries((current) => {
        const next = current.filter((entry) => entry.until > now);
        return next.length === current.length ? current : next;
      });
    }, 1_000);
    return () => clearInterval(timer);
  }, [entries.length === 0]);

  if (entries.length === 0) return null;

  return h('div', { className: 'dgm-toasts', role: 'status', 'aria-live': 'polite' },
    ...entries.map(({ item }) => h('div', {
      key: item.seq,
      className: 'dgm-toast',
      'data-kind': item.kind,
    },
    h('div', { className: 'dgm-toast-head' },
      h('span', { className: 'dgm-toast-kind' }, kindLabel(t, item.kind)),
      h('button', {
        type: 'button',
        className: 'dgm-toast-close',
        'aria-label': t('关闭'),
        onClick: () => dismiss(item.seq),
      }, '×')),
    item.url === undefined
      ? h('p', { className: 'dgm-toast-title' }, item.title)
      : h('a', {
        className: 'dgm-toast-title',
        href: item.url,
        target: '_blank',
        rel: 'noreferrer noopener',
      }, item.title),
    h('div', { className: 'dgm-toast-meta' }, metaOf(t, item)))));
}
