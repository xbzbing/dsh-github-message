// 轮询配置卡片：仓库与组织范围、Issue/PR 的 owned 开关、检查周期，共用一个保存按钮。
// 拆出来只为让 panel.ts 保持在可读长度；交互与校验仍由 panel 持有。

import * as React from 'react';

import { MAX_CLIENT_INTERVAL_MINUTES, MIN_CLIENT_INTERVAL_MINUTES } from '../constants.ts';
import type { Translate } from './locale.ts';
import { card, formatInterval, formatTime } from './views.ts';

const h = React.createElement as unknown as (
  type: unknown,
  props?: Record<string, unknown> | null,
  ...children: unknown[]
) => unknown;

export interface ConfigCardProps {
  t: Translate;
  open: boolean;
  onToggle: () => void;
  busy: boolean;
  interval: string;
  repos: string;
  issueScope: 'repos' | 'owned';
  prScope: 'review' | 'owned';
  orgs: string;
  maxRepos?: number;
  maxOrgs?: number;
  intervalMs?: number;
  nextPollAt?: number;
  backoffMs: number;
  onInterval: (value: string) => void;
  onRepos: (value: string) => void;
  onIssueScope: (value: 'repos' | 'owned') => void;
  onPrScope: (value: 'review' | 'owned') => void;
  onOrgs: (value: string) => void;
  onSave: () => void;
}

export function configCard(props: ConfigCardProps): unknown {
  const { t, maxRepos = 10, maxOrgs = 10 } = props;
  const showOrgs = props.issueScope === 'owned' || props.prScope === 'owned';
  return card({
    id: 'poll',
    title: t('轮询配置'),
    className: 'icm-card--wide',
    open: props.open,
    onToggle: props.onToggle,
    children: [
      h('div', { className: 'icm-config-stack' },
        h('div', { className: 'icm-field-block' },
          h('h4', null, t('维护仓库')),
          h('p', { className: 'icm-note' },
            t('每行一个 owner/repo，最多 {max} 个。Issue 与 PR 的默认范围都从这里开始。', { max: maxRepos })),
          h('label', { className: 'icm-check' },
            h('input', {
              type: 'checkbox',
              checked: props.issueScope === 'owned',
              onChange: (event: { target: { checked: boolean } }) => {
                props.onIssueScope(event.target.checked ? 'owned' : 'repos');
              },
            }),
            h('span', null, t('自动覆盖我名下的所有仓库'))),
          h('p', { className: 'icm-hint' },
            t('开启后还会查询当前账号名下的仓库，以及下面列出的组织；上面的仓库列表始终保留。')),
          h('label', { className: 'icm-check' },
            h('input', {
              type: 'checkbox',
              checked: props.prScope === 'owned',
              onChange: (event: { target: { checked: boolean } }) => {
                props.onPrScope(event.target.checked ? 'owned' : 'review');
              },
            }),
            h('span', null, t('自动覆盖我名下仓库的新 PR'))),
          h('p', { className: 'icm-hint' },
            t('开启后会查询当前账号、组织与上面列出的仓库里别人开的 PR；需要核心同时打开「仓库自有 PR 评审」（review.repoPr），否则核心会忽略。')),
          h('label', { className: 'icm-field' },
            h('span', null, t('仓库列表')),
            h('textarea', {
              className: 'icm-textarea',
              rows: 4,
              spellCheck: false,
              value: props.repos,
              placeholder: 'owner/repo',
              onChange: (event: { target: { value: string } }) => props.onRepos(event.target.value),
            })),
          showOrgs
            ? h('div', null,
                h('label', { className: 'icm-field' },
                  h('span', null, t('组织列表')),
                  h('textarea', {
                    className: 'icm-textarea',
                    rows: 3,
                    spellCheck: false,
                    value: props.orgs,
                    placeholder: 'my-org',
                    onChange: (event: { target: { value: string } }) => props.onOrgs(event.target.value),
                  })),
                h('p', { className: 'icm-hint' },
                  t('每行一个组织名，最多 {max} 个；Issue 与 PR 的 owned 范围共用这份列表，核心回源时只提醒你有写权限的仓库。', { max: maxOrgs })))
            : null),
        h('div', { className: 'icm-field-block' },
          h('h4', null, t('检查周期')),
          h('p', { className: 'icm-note' },
            t('当前周期：{interval}', { interval: formatInterval(props.intervalMs, t) }),
            ' · ',
            t('下一轮：{time}', { time: formatTime(props.nextPollAt) }),
            props.backoffMs > 0 ? ` · ${t('失败退避')} ${formatInterval(props.backoffMs, t)}` : ''),
          h('label', { className: 'icm-field' },
            h('span', null, t('检查周期（分钟）')),
            h('input', {
              className: 'icm-input',
              type: 'number',
              min: MIN_CLIENT_INTERVAL_MINUTES,
              max: MAX_CLIENT_INTERVAL_MINUTES,
              step: 1,
              value: props.interval,
              onChange: (event: { target: { value: string } }) => props.onInterval(event.target.value),
            })),
          h('p', { className: 'icm-hint' },
            t('可设置 {min} 到 {max} 分钟，默认 5 分钟；实际间隔不会短于 GitHub 的 X-Poll-Interval。', {
              min: MIN_CLIENT_INTERVAL_MINUTES,
              max: MAX_CLIENT_INTERVAL_MINUTES,
            })))),
      h('div', { className: 'icm-actions' },
        h('button', {
          type: 'button',
          className: 'icm-btn icm-btn--primary',
          disabled: props.busy,
          onClick: props.onSave,
        }, props.busy ? t('保存中…') : t('保存配置'))),
    ],
  });
}
