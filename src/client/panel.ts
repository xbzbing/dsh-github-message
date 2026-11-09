// GitHub 消息设置页：登录、核心能力、轮询配置、运行统计与核心信号。
// 只用 React.createElement，不引入宿主私有原语。

import * as React from 'react';

import {
  HOST_CONTRACT,
  MAX_CLIENT_INTERVAL_MINUTES,
  MIN_CLIENT_INTERVAL_MINUTES,
  PLUGIN_VERSION,
  REFRESH_INTERVAL_MS,
} from '../constants.ts';
import type { Translate } from './locale.ts';
import type { RpcCall } from './rpc.ts';
import { STYLES } from './styles.ts';
import { configCard } from './config-card.ts';
import {
  apiLabel,
  apiTone,
  card,
  chip,
  formatNumber,
  formatTime,
  historyTable,
  kindTable,
  lastSummary,
  loginNote,
  minutesOf,
  reminderNote,
  row,
  signalChips,
  sourceLabel,
  sourceTone,
  type Status,
} from './views.ts';

const { useCallback, useEffect, useRef, useState } = React;
const h = React.createElement as unknown as (
  type: unknown,
  props?: Record<string, unknown> | null,
  ...children: unknown[]
) => unknown;

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ORG_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

interface Props {
  t: Translate;
  rpcCall: RpcCall;
  [key: string]: unknown;
}

function ensureStyles(): void {
  if (typeof document === 'undefined') return;
  // 同一个 style 元素复用并刷新内容：插件热重载时组件实例可能还在，
  // 只按 id 判断「已注入」会让新样式永远进不来。
  let style = document.getElementById('dgm-styles') as HTMLStyleElement | null;
  if (style === null) {
    style = document.createElement('style');
    style.id = 'dgm-styles';
    document.head.appendChild(style);
  }
  if (style.textContent !== STYLES) style.textContent = STYLES;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function metric(label: string, value: string, tone?: string): unknown {
  return h('div', { className: 'icm-metric', ...(tone === undefined ? {} : { 'data-tone': tone }) },
    h('span', { className: 'icm-metric-label' }, label),
    h('strong', { className: 'icm-metric-value' }, value));
}

export function GithubMessagePanel(props: Props): unknown {
  const { t, rpcCall } = props;
  ensureStyles();

  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [intervalDraft, setIntervalDraft] = useState('5');
  const [reposDraft, setReposDraft] = useState('');
  const [scopeDraft, setScopeDraft] = useState<'repos' | 'owned'>('repos');
  const [prScopeDraft, setPrScopeDraft] = useState<'review' | 'owned'>('review');
  const [orgsDraft, setOrgsDraft] = useState('');
  /** 折叠状态：默认只收起运行统计，其余展开。 */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ stats: true });
  const mounted = useRef(true);
  const dirtyInterval = useRef(false);
  const dirtyRepos = useRef(false);
  const dirtyScope = useRef(false);
  const dirtyPrScope = useRef(false);
  const dirtyOrgs = useRef(false);

  const isOpen = (id: string): boolean => collapsed[id] !== true;
  const toggle = (id: string): void => {
    setCollapsed((current) => ({ ...current, [id]: current[id] !== true }));
  };

  const load = useCallback(async (silent = false): Promise<void> => {
    if (!silent) setLoading(true);
    try {
      const next = await rpcCall<Status>('status');
      if (!mounted.current) return;
      setStatus(next);
      if (!dirtyInterval.current) setIntervalDraft(minutesOf(next.config?.intervalMs));
      if (!dirtyRepos.current) setReposDraft((next.config?.repos ?? []).join('\n'));
      if (!dirtyScope.current) setScopeDraft(next.config?.issueScope === 'owned' ? 'owned' : 'repos');
      if (!dirtyPrScope.current) setPrScopeDraft(next.config?.prScope === 'owned' ? 'owned' : 'review');
      if (!dirtyOrgs.current) setOrgsDraft((next.config?.orgs ?? []).join('\n'));
      setError('');
    } catch (failure) {
      if (mounted.current) setError(t('读取状态失败：{error}', { error: errorText(failure) }));
    } finally {
      if (mounted.current && !silent) setLoading(false);
    }
  }, [rpcCall, t]);

  useEffect(() => {
    mounted.current = true;
    void load();
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') void load(true);
    }, REFRESH_INTERVAL_MS);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [load]);

  const run = useCallback(async (method: string, done: string): Promise<void> => {
    setBusy(method);
    setNotice('');
    try {
      const next = await rpcCall<Status>(method);
      if (!mounted.current) return;
      setStatus(next);
      setNotice(done);
    } catch (failure) {
      if (mounted.current) setNotice(t('操作失败：{error}', { error: errorText(failure) }));
    } finally {
      if (mounted.current) setBusy('');
    }
  }, [rpcCall, t]);

  const refresh = useCallback(async (): Promise<void> => {
    setBusy('refresh');
    await load(true);
    if (mounted.current) setBusy('');
  }, [load]);

  /** 仓库与周期共用一个保存动作：先校验，再一次性写回。 */
  const saveConfig = useCallback(async (): Promise<void> => {
    const lines = reposDraft.split('\n').map((line) => line.trim()).filter((line) => line !== '');
    const repos: string[] = [];
    for (const line of lines) {
      if (!REPO_PATTERN.test(line)) {
        setNotice(t('仓库名不合法：{repo}', { repo: line }));
        return;
      }
      if (!repos.some((repo) => repo.toLowerCase() === line.toLowerCase())) repos.push(line);
    }
    const max = status?.config?.maxRepos ?? 10;
    if (repos.length > max) {
      setNotice(t('最多 {max} 个仓库', { max }));
      return;
    }

    const orgsInUse = scopeDraft === 'owned' || prScopeDraft === 'owned';
    const orgLines = orgsDraft.split('\n').map((line) => line.trim()).filter((line) => line !== '');
    const orgs: string[] = [];
    for (const line of orgLines) {
      if (!ORG_PATTERN.test(line)) {
        // 组织列表只在 owned 模式生效；关闭时忽略非法行，避免隐藏字段阻塞保存。
        if (orgsInUse) {
          setNotice(t('组织名不合法：{org}', { org: line }));
          return;
        }
        continue;
      }
      if (!orgs.some((org) => org.toLowerCase() === line.toLowerCase())) orgs.push(line);
    }
    const maxOrgs = status?.config?.maxOrgs ?? 10;
    if (orgsInUse && orgs.length > maxOrgs) {
      setNotice(t('最多 {max} 个组织', { max: maxOrgs }));
      return;
    }

    const minutes = Number(intervalDraft);
    if (!Number.isFinite(minutes)) {
      setNotice(t('检查周期必须是数字'));
      return;
    }
    if (minutes < MIN_CLIENT_INTERVAL_MINUTES || minutes > MAX_CLIENT_INTERVAL_MINUTES) {
      setNotice(t('检查周期需在 {min} 到 {max} 分钟之间', {
        min: MIN_CLIENT_INTERVAL_MINUTES,
        max: MAX_CLIENT_INTERVAL_MINUTES,
      }));
      return;
    }

    setBusy('config.set');
    setNotice('');
    try {
      const next = await rpcCall<Status>('config.set', {
        intervalMs: Math.round(minutes * 60_000),
        repos,
        issueScope: scopeDraft,
        prScope: prScopeDraft,
        orgs,
      });
      if (!mounted.current) return;
      setStatus(next);
      dirtyInterval.current = false;
      dirtyRepos.current = false;
      dirtyScope.current = false;
      dirtyPrScope.current = false;
      dirtyOrgs.current = false;
      setIntervalDraft(minutesOf(next.config?.intervalMs));
      setReposDraft((next.config?.repos ?? []).join('\n'));
      setScopeDraft(next.config?.issueScope === 'owned' ? 'owned' : 'repos');
      setPrScopeDraft(next.config?.prScope === 'owned' ? 'owned' : 'review');
      setOrgsDraft((next.config?.orgs ?? []).join('\n'));
      setNotice(t('已保存轮询配置'));
    } catch (failure) {
      if (mounted.current) setNotice(t('操作失败：{error}', { error: errorText(failure) }));
    } finally {
      if (mounted.current) setBusy('');
    }
  }, [intervalDraft, reposDraft, scopeDraft, prScopeDraft, orgsDraft, rpcCall, status?.config?.maxRepos, status?.config?.maxOrgs, t]);

  if (loading && status === null) {
    return h('div', { className: 'icm-panel' }, h('p', { className: 'icm-muted' }, t('正在读取…')));
  }

  const login = status?.login;
  const config = status?.config;
  const stats = status?.stats;
  const reminders = status?.reminders;
  const source = status?.source;
  const registered = source?.registered === true;
  const standalone = source?.standalone === true;
  const featureSupported = source?.featureSupported === true;
  const notices = status?.notices;
  const contractMismatch = status !== null && status.contractVersion !== HOST_CONTRACT;
  const note = loginNote(t, login);
  const canPoll = registered;
  const backoff = status?.poll?.backoffMs ?? 0;

  return h('div', { className: 'icm-panel' },
    h('header', { className: 'icm-header' },
      h('div', null,
        h('h2', { className: 'icm-title' }, t('GitHub 消息')),
        h('p', { className: 'icm-subtitle' },
          t('插件版本 {version}', { version: status?.plugin?.version ?? PLUGIN_VERSION }),
          registered ? ` · ${t('已接入')}` : ` · ${t('未接入')}`,
          ` · ${sourceLabel(t, source?.state)}`)),
      h('div', { className: 'icm-header-actions' },
        h('span', { className: 'icm-pill', 'data-tone': sourceTone(source?.state) }, sourceLabel(t, source?.state)),
        h('button', {
          type: 'button',
          className: 'icm-btn',
          disabled: busy !== '',
          onClick: () => void refresh(),
        }, busy === 'refresh' ? t('刷新中…') : t('刷新')))),

    error !== '' ? h('div', { className: 'icm-banner', role: 'alert', 'data-tone': 'danger' }, error) : null,
    contractMismatch ? h('div', { className: 'icm-banner', role: 'alert', 'data-tone': 'warning' },
      t('面板与后台版本不一致，请卸载后重新安装插件。')) : null,
    notice !== '' ? h('div', { className: 'icm-banner', role: 'status' }, notice) : null,

    h('div', { className: 'icm-overview' },
      metric(t('三路上报'), formatNumber(stats?.emitted)),
      metric(t('待上报'), formatNumber(stats?.deferred)),
      metric(t('错误'), formatNumber(stats?.errors), (stats?.errors ?? 0) > 0 ? 'danger' : undefined),
      metric(t('核心信号'), formatNumber(reminders?.total))),

    h('div', { className: 'icm-grid' },
      card({
        id: 'login',
        title: t('GitHub 登录'),
        className: 'icm-card--primary',
        open: isOpen('login'),
        onToggle: () => toggle('login'),
        pill: h('span', { className: 'icm-pill', 'data-tone': apiTone(login) }, apiLabel(t, login)),
        children: [
          h('dl', { className: 'icm-kv' },
            row(t('账号'), login?.username ?? '—'),
            row(t('认证方式'), login?.tokenSource ?? '—'),
            row(t('Token scopes'), login?.scopes?.length ? login.scopes.join(', ') : '—'),
            row(t('@ 方式'), config?.effectiveMentionMode ?? '—'),
            row(t('通知权限'), login?.notifications === 'ok'
              ? t('有')
              : login?.notifications === 'missing' ? t('缺失') : t('未知')),
            row(t('最近检查'), formatTime(login?.checkedAt))),
          note !== undefined ? h('p', { className: 'icm-note' }, note) : null,
          login?.detail !== undefined && note === undefined
            ? h('p', { className: 'icm-hint icm-code' }, login.detail)
            : null,
          h('div', { className: 'icm-actions' },
            h('button', {
              type: 'button',
              className: 'icm-btn icm-btn--primary',
              disabled: busy !== '',
              onClick: () => void run('login.check', t('登录检查完成')),
            }, busy === 'login.check' ? t('检查中…') : t('检查登录'))),
        ],
      }),

      card({
        id: 'core',
        title: t('核心能力'),
        className: 'icm-card--secondary',
        open: isOpen('core'),
        onToggle: () => toggle('core'),
        pill: h('span', { className: 'icm-pill', 'data-tone': featureSupported ? 'success' : 'warning' },
          featureSupported
            ? t('核心已支持 GitHub 来源')
            : standalone ? t('未接入超级助理') : t('核心缺少 GitHub 来源能力')),
        children: [
          h('p', { className: 'icm-note' }, featureSupported
            ? t('信号会经核心回源确认后进入通知链路；来源关闭时不会落库。')
            : standalone
              ? t('新消息会在右下角弹出提示，并计入待上报；接入超级助理后由核心接管通知。')
              : t('当前核心缺少 github-source 能力，插件只采集候选、不向核心上报。升级 dsh-my-superagent 后重新加载插件即可补齐。')),
          h('dl', { className: 'icm-kv' },
            row(t('来源状态'), sourceLabel(t, source?.state)),
            row(t('来源'), source?.id ?? '—'),
            row(t('协议'), source?.protocol ?? '—'),
            row(t('信任级别'), source?.trust ?? '—'),
            row(t('本地提示'), formatNumber(notices?.count))),
          h('p', { className: 'icm-hint' },
            t('来源在超级助理的「来源」页关闭时，信号不会落库；打开后下一轮自动补齐。')),
        ],
      }),

      configCard({
        t,
        open: isOpen('poll'),
        onToggle: () => toggle('poll'),
        busy: busy === 'config.set',
        interval: intervalDraft,
        repos: reposDraft,
        issueScope: scopeDraft,
        prScope: prScopeDraft,
        orgs: orgsDraft,
        maxRepos: config?.maxRepos,
        maxOrgs: config?.maxOrgs,
        intervalMs: config?.intervalMs,
        nextPollAt: status?.poll?.nextPollAt,
        backoffMs: backoff,
        onInterval: (value) => {
          dirtyInterval.current = true;
          setIntervalDraft(value);
        },
        onRepos: (value) => {
          dirtyRepos.current = true;
          setReposDraft(value);
        },
        onIssueScope: (value) => {
          dirtyScope.current = true;
          setScopeDraft(value);
        },
        onPrScope: (value) => {
          dirtyPrScope.current = true;
          setPrScopeDraft(value);
        },
        onOrgs: (value) => {
          dirtyOrgs.current = true;
          setOrgsDraft(value);
        },
        onSave: () => void saveConfig(),
      }),

      card({
        id: 'stats',
        title: t('运行统计'),
        className: 'icm-card--wide',
        open: isOpen('stats'),
        onToggle: () => toggle('stats'),
        actions: h('div', { className: 'icm-actions icm-actions--head' },
          h('button', {
            type: 'button',
            className: 'icm-btn',
            disabled: busy !== '' || !canPoll,
            onClick: () => void run('poll.now', t('已触发一次检查')),
          }, busy === 'poll.now' ? t('检查中…') : t('立即检查')),
          h('button', {
            type: 'button',
            className: 'icm-btn',
            disabled: busy !== '',
            onClick: () => void run('stats.reset', t('统计已重置')),
          }, t('重置统计'))),
        children: [
          h('div', { className: 'icm-section' },
            h('div', { className: 'icm-section-head' },
              h('h4', null, t('三路上报')),
              chip(`${t('累计')} ${formatNumber(stats?.emitted)}`, (stats?.emitted ?? 0) > 0 ? 'success' : undefined)),
            kindTable(t, stats)),

          h('div', { className: 'icm-section icm-section--split' },
            h('div', { className: 'icm-section-col' },
              h('div', { className: 'icm-section-head' },
                h('h4', null, t('最近轮询')),
                chip(
                  stats?.lastPollOk === undefined ? t('未知')
                    : stats.lastPollOk ? t('成功') : t('失败'),
                  stats?.lastPollOk === undefined ? undefined : stats.lastPollOk ? 'success' : 'danger')),
              h('dl', { className: 'icm-kv' },
                row(t('时间'), formatTime(stats?.lastPollAt)),
                row(t('上报'), formatNumber(lastSummary(stats)?.emitted ?? 0)),
                row(t('去重'), formatNumber(lastSummary(stats)?.duplicates ?? 0))),
              stats?.lastPollOk === false && stats.lastError !== undefined
                ? h('p', { className: 'icm-note icm-note--danger' }, stats.lastError)
                : null),
            h('div', { className: 'icm-section-col' },
              h('div', { className: 'icm-section-head' },
                h('h4', null, t('核心信号')),
                chip(`${t('总数')} ${formatNumber(reminders?.total)}`,
                  (reminders?.total ?? 0) > 0 ? 'success' : undefined)),
              reminders !== undefined && (reminders.total ?? 0) > 0
                ? h('div', { className: 'icm-chips' }, ...signalChips(t, reminders))
                : h('p', { className: 'icm-note' }, reminderNote(t, reminders)),
              (reminders?.total ?? 0) > 0
                ? h('p', { className: 'icm-hint' }, reminderNote(t, reminders))
                : null)),

          h('div', { className: 'icm-section' },
            h('div', { className: 'icm-section-head' },
              h('h4', null, t('轮询历史')),
              h('span', { className: 'icm-hint' }, t('最近 5 轮'))),
            historyTable(t, stats?.history ?? [])),
        ],
      })),

    h('p', { className: 'icm-footnote' },
      t('插件只读 GitHub，不评审、不评论、不写回；评审与 Issue 分析由超级助理完成。')));
}
