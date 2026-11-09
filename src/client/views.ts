// 面板的展示类型与纯函数：不依赖 React，便于单独阅读与复用。

import * as React from 'react';

import type { Translate } from './locale.ts';

const h = React.createElement as unknown as (
  type: unknown,
  props?: Record<string, unknown> | null,
  ...children: unknown[]
) => unknown;

export interface KindStats {
  emitted?: number;
  duplicates?: number;
  filtered?: number;
  skipped?: number;
  deferred?: number;
  errors?: number;
}

export interface StreamSummary extends KindStats {
  fetched?: number;
  authenticated?: boolean;
}

export interface Summary {
  at?: number;
  review?: StreamSummary;
  issue?: StreamSummary;
  mention?: StreamSummary;
  fetched?: number;
  emitted?: number;
  duplicates?: number;
  filtered?: number;
  skipped?: number;
  deferred?: number;
  errors?: string[];
  authenticated?: boolean;
  sourceDisabled?: boolean;
  rateLimitResetAt?: number;
  pollIntervalMs?: number;
  mentionNotModified?: boolean;
  mentionComplete?: boolean;
  dryRun?: boolean;
}

export interface Stats {
  polls?: number;
  emitted?: number;
  duplicates?: number;
  filtered?: number;
  skipped?: number;
  deferred?: number;
  errors?: number;
  byKind?: Record<string, KindStats>;
  lastPollAt?: number;
  lastPollOk?: boolean;
  lastEmittedAt?: number;
  lastSuccessAt?: number;
  lastError?: string;
  lastErrorAt?: number;
  history?: Summary[];
}

export interface Login {
  installed?: boolean;
  authenticated?: boolean;
  api?: string;
  notifications?: string;
  scopes?: string[];
  username?: string;
  tokenSource?: string;
  checkedAt?: number;
  detail?: string;
  reason?: string;
}

export interface Reminders {
  available?: boolean;
  total?: number;
  byState?: Record<string, number>;
  byKind?: Record<string, Record<string, number>>;
  code?: string;
  detail?: string;
  note?: string;
}

export interface Status {
  contractVersion?: number;
  plugin?: { name?: string; version?: string; startedAt?: number; dataDir?: string };
  source?: {
    registered?: boolean;
    standalone?: boolean;
    id?: string;
    kinds?: string[];
    protocol?: string;
    trust?: string;
    featureSupported?: boolean;
    requiredFeature?: string;
    state?: string;
  };
  config?: {
    intervalMs?: number;
    intervalMinutes?: number;
    windowMs?: number;
    repos?: string[];
    issueScope?: string;
    orgs?: string[];
    maxRepos?: number;
    maxOrgs?: number;
    maxResults?: number;
    maxPages?: number;
    includeDrafts?: boolean;
    mentionMode?: string;
    effectiveMentionMode?: string;
    timeoutMs?: number;
    cliPath?: string;
  };
  login?: Login;
  poll?: {
    started?: boolean;
    running?: boolean;
    nextPollAt?: number;
    lastPollAt?: number;
    lastSummary?: Summary;
    backoffMs?: number;
  };
  stats?: Stats;
  reminders?: Reminders;
  notices?: { enabled?: boolean; count?: number; lastAt?: number };
}

export function formatTime(value: number | undefined): string {
  return value === undefined ? '—' : new Date(value).toLocaleString();
}

export function formatNumber(value: number | undefined): string {
  return value === undefined ? '—' : value.toLocaleString();
}

export function formatInterval(ms: number | undefined, t: Translate): string {
  if (ms === undefined) return '—';
  if (ms < 60_000) return `${Math.round(ms / 1000)} ${t('秒')}`;
  const minutes = ms / 60_000;
  const text = Number.isInteger(minutes) ? String(minutes) : String(Math.round(minutes * 10) / 10);
  return `${text} ${t('分钟')}`;
}

export function minutesOf(ms: number | undefined): string {
  if (ms === undefined) return '5';
  const minutes = ms / 60_000;
  return Number.isInteger(minutes) ? String(minutes) : String(Math.round(minutes * 10) / 10);
}

export function sourceLabel(t: Translate, state: string | undefined): string {
  switch (state) {
    case 'running': return t('运行中');
    case 'standalone': return t('本地提示');
    case 'dry-run': return t('采集但不推送');
    case 'paused': return t('已暂停');
    default: return t('等待开启');
  }
}

export function sourceTone(state: string | undefined): string {
  if (state === 'running') return 'success';
  if (state === 'standalone' || state === 'dry-run') return 'warning';
  if (state === 'paused') return 'danger';
  return 'muted';
}

export function apiLabel(t: Translate, login: Login | undefined): string {
  if (login?.installed === false) return t('未安装 gh');
  if (login?.checkedAt === undefined && login?.api === 'unknown') return t('待检查');
  if (login?.api === 'ok') return t('API 正常');
  if (login?.api === 'expired') return t('凭据失效');
  if (login?.api === 'error') return t('API 异常');
  return login?.authenticated === true ? t('已登录') : t('未登录');
}

export function apiTone(login: Login | undefined): string {
  if (login?.installed === false) return 'danger';
  if (login?.api === 'ok') return 'success';
  if (login?.api === 'expired' || login?.api === 'error') return 'danger';
  return 'muted';
}

export function loginNote(t: Translate, login: Login | undefined): string | undefined {
  if (login === undefined) return undefined;
  if (login.installed === false) return t('未检测到 GitHub CLI（gh）。安装后执行 gh auth login。');
  if (login.checkedAt === undefined && login.api === 'unknown') return undefined;
  if (login.api === 'expired' || login.reason === 'credential') return t('凭据已失效，请重新执行 gh auth login。');
  if (login.authenticated === false || login.reason === 'not-logged-in') return t('还没有登录 GitHub。执行 gh auth login 后再检查。');
  if (login.notifications === 'missing') {
    return t('当前 token 缺少 notifications scope，@ 提醒会降级或不可用；可执行 gh auth refresh -s notifications。');
  }
  return undefined;
}

export function reminderNote(t: Translate, reminders: Reminders | undefined): string {
  if (reminders === undefined) return '';
  switch (reminders.code) {
    case 'db-missing': return t('未找到超级助理数据库（dsh-my-superagent 未安装或尚未启动）');
    case 'empty': return t('还没有落库信号');
    case 'ok': return t('ignored 表示回源未通过或来源关闭；admitted/digested 才会进入通知链路');
    case 'read-failed': return t('读取超级助理信号失败：{error}', { error: reminders.detail ?? '' });
    default: return reminders.note ?? '';
  }
}

export function kindLabel(t: Translate, kind: string): string {
  if (kind === 'review') return t('待评审 PR');
  if (kind === 'issue') return t('新 Issue');
  if (kind === 'mention') return t('@ 提醒');
  if (kind === 'selfPr') return t('自提 PR');
  return kind;
}

export function row(label: string, value: string): unknown {
  return h('div', { className: 'icm-kv-row', key: label },
    h('dt', null, label),
    h('dd', null, value));
}

export interface CardOptions {
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  className?: string;
  pill?: unknown;
  actions?: unknown;
  children: unknown[];
}

/** 可折叠卡片：标题本身是按钮，右侧留给状态徽标或操作。 */
export function card(options: CardOptions): unknown {
  const { id, title, open, onToggle } = options;
  return h('section', {
    className: `icm-card${options.className === undefined ? '' : ` ${options.className}`}`,
    'data-open': open ? 'true' : 'false',
  },
  h('div', { className: 'icm-card-head' },
    h('h3', { className: 'icm-card-title' },
      h('button', {
        type: 'button',
        className: 'icm-card-toggle',
        'aria-expanded': open ? 'true' : 'false',
        'aria-controls': `icm-body-${id}`,
        onClick: onToggle,
      },
      h('span', { className: 'icm-chevron', 'aria-hidden': 'true' }),
      h('span', null, title))),
    options.pill ?? null,
    options.actions ?? null),
  open
    ? h('div', { className: 'icm-card-body', id: `icm-body-${id}` }, ...options.children)
    : null);
}

export function streamStats(stats: Stats | undefined, name: string): KindStats {
  return stats?.byKind?.[name] ?? {};
}

export function kindTable(t: Translate, stats: Stats | undefined): unknown {
  const rows: unknown[] = [];
  for (const name of ['review', 'issue', 'mention', 'selfPr']) {
    const item = streamStats(stats, name);
    rows.push(h('tr', { key: name },
      h('td', null, kindLabel(t, name)),
      h('td', null, formatNumber(item.emitted)),
      h('td', null, formatNumber(item.duplicates)),
      h('td', null, formatNumber(item.filtered)),
      h('td', null, formatNumber(item.deferred)),
      h('td', null, formatNumber(item.errors))));
  }
  rows.push(h('tr', { key: 'total' },
    h('td', null, h('strong', null, t('累计'))),
    h('td', null, h('strong', null, formatNumber(stats?.emitted))),
    h('td', null, h('strong', null, formatNumber(stats?.duplicates))),
    h('td', null, h('strong', null, formatNumber(stats?.filtered))),
    h('td', null, h('strong', null, formatNumber(stats?.deferred))),
    h('td', null, h('strong', null, formatNumber(stats?.errors)))));
  return h('div', { className: 'icm-table-wrap' },
    h('table', { className: 'icm-table icm-table--stats' },
      h('thead', null, h('tr', null,
        h('th', null, t('类型')),
        h('th', null, t('上报')),
        h('th', null, t('去重')),
        h('th', null, t('过滤')),
        h('th', null, t('待上报')),
        h('th', null, t('错误')))),
      h('tbody', null, ...rows)));
}

export function chip(text: string, tone?: string): unknown {
  return h('span', { className: 'icm-chip', ...(tone === undefined ? {} : { 'data-tone': tone }) }, text);
}

export function lastSummary(stats: Stats | undefined): Summary | undefined {
  const history = stats?.history ?? [];
  return history[history.length - 1];
}

export function historyTable(t: Translate, history: Summary[]): unknown {
  if (history.length === 0) return h('p', { className: 'icm-note' }, t('还没有轮询记录'));
  const rows = history.slice(-5).reverse();
  return h('div', { className: 'icm-table-wrap' },
    h('table', { className: 'icm-table' },
      h('thead', null, h('tr', null,
        h('th', null, t('时间')),
        h('th', null, t('待评审 PR')),
        h('th', null, t('新 Issue')),
        h('th', null, t('@ 提醒')),
        h('th', null, t('去重')),
        h('th', null, t('错误')))),
      h('tbody', null, ...rows.map((item, index) => h('tr', { key: `${item.at ?? 'row'}-${index}` },
        h('td', null, formatTime(item.at)),
        h('td', null, formatNumber(item.review?.emitted)),
        h('td', null, formatNumber(item.issue?.emitted)),
        h('td', null, formatNumber(item.mention?.emitted)),
        h('td', null, formatNumber(item.duplicates)),
        h('td', null, formatNumber(item.errors?.length)))))));
}

export function signalChips(t: Translate, reminders: Reminders | undefined): unknown[] {
  const chips: unknown[] = [];
  for (const [state, count] of Object.entries(reminders?.byState ?? {}).filter(([, value]) => value > 0)) {
    const tone = state === 'ignored' ? 'warning'
      : state === 'admitted' || state === 'digested' ? 'success' : undefined;
    chips.push(chip(`${state} ${formatNumber(count)}`, tone));
  }
  for (const [kind, states] of Object.entries(reminders?.byKind ?? {})) {
    const detail = Object.entries(states).map(([state, count]) => `${state} ${count}`).join(' · ');
    chips.push(chip(`${kindLabel(t, kind)} · ${detail}`));
  }
  return chips;
}

