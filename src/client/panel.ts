// GitHub 消息设置页：登录、核心能力、维护仓库、检查周期、三路统计与核心信号。
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
import {
  apiLabel,
  apiTone,
  coreSignalRows,
  formatInterval,
  formatNumber,
  formatTime,
  historyTable,
  kindTable,
  loginNote,
  minutesOf,
  reminderNote,
  row,
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

interface Props {
  t: Translate;
  rpcCall: RpcCall;
  [key: string]: unknown;
}

function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('dgm-styles') !== null) return;
  const style = document.createElement('style');
  style.id = 'dgm-styles';
  style.textContent = STYLES;
  document.head.appendChild(style);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  const mounted = useRef(true);
  const dirtyInterval = useRef(false);
  const dirtyRepos = useRef(false);

  const load = useCallback(async (silent = false): Promise<void> => {
    if (!silent) setLoading(true);
    try {
      const next = await rpcCall<Status>('status');
      if (!mounted.current) return;
      setStatus(next);
      if (!dirtyInterval.current) setIntervalDraft(minutesOf(next.config?.intervalMs));
      if (!dirtyRepos.current) setReposDraft((next.config?.repos ?? []).join('\n'));
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

  const saveInterval = useCallback(async (): Promise<void> => {
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
      const next = await rpcCall<Status>('config.set', { intervalMs: Math.round(minutes * 60_000) });
      if (!mounted.current) return;
      setStatus(next);
      dirtyInterval.current = false;
      const actual = minutesOf(next.config?.intervalMs);
      setIntervalDraft(actual);
      setNotice(t('已保存检查周期：{minutes} 分钟', { minutes: actual }));
    } catch (failure) {
      if (mounted.current) setNotice(t('操作失败：{error}', { error: errorText(failure) }));
    } finally {
      if (mounted.current) setBusy('');
    }
  }, [intervalDraft, rpcCall, t]);

  const saveRepos = useCallback(async (): Promise<void> => {
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
    setBusy('config.set');
    setNotice('');
    try {
      const next = await rpcCall<Status>('config.set', { repos });
      if (!mounted.current) return;
      setStatus(next);
      dirtyRepos.current = false;
      setReposDraft((next.config?.repos ?? []).join('\n'));
      setNotice(t('已保存仓库列表'));
    } catch (failure) {
      if (mounted.current) setNotice(t('操作失败：{error}', { error: errorText(failure) }));
    } finally {
      if (mounted.current) setBusy('');
    }
  }, [reposDraft, rpcCall, status?.config?.maxRepos, t]);

  if (loading && status === null) {
    return h('div', { className: 'icm-panel' }, h('p', { className: 'icm-muted' }, t('正在读取…')));
  }

  const login = status?.login;
  const config = status?.config;
  const stats = status?.stats;
  const reminders = status?.reminders;
  const source = status?.source;
  const registered = source?.registered === true;
  const featureSupported = source?.featureSupported === true;
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

    h('div', { className: 'icm-grid' },
      h('section', { className: 'icm-card' },
        h('div', { className: 'icm-card-head' },
          h('h3', null, t('GitHub 登录')),
          h('span', { className: 'icm-pill', 'data-tone': apiTone(login) }, apiLabel(t, login))),
        h('dl', { className: 'icm-kv' },
          row(t('账号'), login?.username ?? '—'),
          row(t('认证方式'), login?.tokenSource ?? '—'),
          row(t('Token scopes'), login?.scopes?.length ? login.scopes.join(', ') : '—'),
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
          }, busy === 'login.check' ? t('检查中…') : t('检查登录')))),

      h('section', { className: 'icm-card' },
        h('div', { className: 'icm-card-head' },
          h('h3', null, t('核心能力')),
          h('span', { className: 'icm-pill', 'data-tone': featureSupported ? 'success' : 'warning' },
            featureSupported ? t('核心已支持 GitHub 来源') : t('核心尚未支持 GitHub 来源'))),
        featureSupported
          ? h('p', { className: 'icm-note' }, t('来源状态'), `：${sourceLabel(t, source?.state)}`)
          : h('p', { className: 'icm-note' },
            t('当前只采集候选，不向核心上报，也不会写入去重状态。核心支持后重新加载插件即可补齐。')),
        !featureSupported && source?.coreIssueUrl !== undefined
          ? h('p', { className: 'icm-hint' },
            h('a', { href: source.coreIssueUrl, target: '_blank', rel: 'noreferrer' }, t('查看核心提案')))
          : null,
        h('dl', { className: 'icm-kv' },
          row(t('来源状态'), sourceLabel(t, source?.state)),
          row(t('来源'), source?.id ?? '—'),
          row(t('协议'), source?.protocol ?? '—'),
          row(t('信任级别'), source?.trust ?? '—')),
        h('p', { className: 'icm-hint' },
          t('来源在超级助理的「来源」页关闭时，信号不会落库；打开后下一轮自动补齐。'))),

      h('section', { className: 'icm-card' },
        h('h3', null, t('维护仓库')),
        h('p', { className: 'icm-note' },
          t('每行一个 owner/repo，最多 {max} 个。新 Issue 只提醒这些仓库。', {
            max: config?.maxRepos ?? 10,
          })),
        h('label', { className: 'icm-field' },
          h('span', null, t('仓库列表')),
          h('textarea', {
            className: 'icm-textarea',
            rows: 6,
            spellCheck: false,
            value: reposDraft,
            placeholder: 'owner/repo',
            onChange: (event: { target: { value: string } }) => {
              dirtyRepos.current = true;
              setReposDraft(event.target.value);
            },
          })),
        h('div', { className: 'icm-actions' },
          h('button', {
            type: 'button',
            className: 'icm-btn icm-btn--primary',
            disabled: busy !== '',
            onClick: () => void saveRepos(),
          }, busy === 'config.set' ? t('保存中…') : t('保存仓库')))),

      h('section', { className: 'icm-card' },
        h('h3', null, t('检查周期')),
        h('p', { className: 'icm-note' },
          t('当前周期：{interval}', { interval: formatInterval(config?.intervalMs, t) }),
          ' · ',
          t('下一轮：{time}', { time: formatTime(status?.poll?.nextPollAt) })),
        backoff > 0
          ? h('p', { className: 'icm-hint' }, `${t('失败')} · ${formatInterval(backoff, t)}`)
          : null,
        h('label', { className: 'icm-field' },
          h('span', null, t('检查周期（分钟）')),
          h('input', {
            className: 'icm-input',
            type: 'number',
            min: MIN_CLIENT_INTERVAL_MINUTES,
            max: MAX_CLIENT_INTERVAL_MINUTES,
            step: 1,
            value: intervalDraft,
            onChange: (event: { target: { value: string } }) => {
              dirtyInterval.current = true;
              setIntervalDraft(event.target.value);
            },
          })),
        h('p', { className: 'icm-hint' }, t('可设置 {min} 到 {max} 分钟，默认 5 分钟。', {
          min: MIN_CLIENT_INTERVAL_MINUTES,
          max: MAX_CLIENT_INTERVAL_MINUTES,
        })),
        h('div', { className: 'icm-actions' },
          h('button', {
            type: 'button',
            className: 'icm-btn icm-btn--primary',
            disabled: busy !== '',
            onClick: () => void saveInterval(),
          }, busy === 'config.set' ? t('保存中…') : t('保存周期')))),

      h('section', { className: 'icm-card icm-card--wide' },
        h('h3', null, t('三路统计')),
        kindTable(t, stats),
        h('div', { className: 'icm-split' },
          h('div', null,
            h('h4', null, t('最近轮询')),
            h('dl', { className: 'icm-kv' },
              row(t('时间'), formatTime(stats?.lastPollAt)),
              row(t('成功'), stats?.lastPollOk === undefined ? '—' : stats.lastPollOk ? t('成功') : t('失败')),
              row(t('上报'), formatNumber(stats?.emitted)),
              row(t('去重'), formatNumber(stats?.duplicates))),
            stats?.lastError !== undefined ? h('p', { className: 'icm-note' }, stats.lastError) : null),
          h('div', null,
            h('h4', null, t('核心信号')),
            h('dl', { className: 'icm-kv' },
              row(t('总数'), formatNumber(reminders?.total)),
              ...coreSignalRows(t, reminders)),
            h('p', { className: 'icm-note' }, reminderNote(t, reminders)))),
        h('h4', { style: { marginTop: '16px' } }, t('最近轮询')),
        historyTable(t, stats?.history ?? []),
        h('div', { className: 'icm-actions' },
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
          }, t('重置统计'))))),

    h('p', { className: 'icm-footnote' },
      t('插件只读 GitHub，不评审、不评论、不写回；评审与 Issue 分析由超级助理完成。')));
}
