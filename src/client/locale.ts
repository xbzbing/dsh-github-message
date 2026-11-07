// 面板文案：中文是键，英文是同一组键的翻译；DSH 语言切换时 bind() 会读取当前语言。
// 键写成中文是为了源码可读；未命中的键会原样返回，因此中文不需要额外的字典值。

import { PACKAGE_NAME } from '../constants.ts';

export const NS = PACKAGE_NAME;
export type Translate = (text: string, values?: Record<string, unknown>) => string;

export const EN: Record<string, string> = {
  'GitHub 消息': 'GitHub Messages',
  '插件版本 {version}': 'Plugin version {version}',
  '已接入': 'Connected',
  '未接入': 'Not connected',
  '刷新': 'Refresh',
  '刷新中…': 'Refreshing…',
  '正在读取…': 'Loading…',
  '读取状态失败：{error}': 'Failed to read status: {error}',
  '面板与后台版本不一致，请卸载后重新安装插件。': 'Panel and host versions differ; uninstall and reinstall the plugin.',

  'GitHub 登录': 'GitHub login',
  '未安装 gh': 'gh not installed',
  '已登录': 'Signed in',
  '未登录': 'Not signed in',
  'API 正常': 'API OK',
  '凭据失效': 'Credential expired',
  'API 异常': 'API error',
  '待检查': 'Not checked',
  '账号': 'Account',
  '认证方式': 'Token source',
  'Token scopes': 'Token scopes',
  '@ 方式': 'Mentions mode',
  '通知权限': 'Notifications scope',
  '有': 'Yes',
  '缺失': 'Missing',
  '未知': 'Unknown',
  '最近检查': 'Last checked',
  '检查登录': 'Check login',
  '检查中…': 'Checking…',
  '登录检查完成': 'Login check finished',
  '未检测到 GitHub CLI（gh）。安装后执行 gh auth login。':
    'GitHub CLI (gh) not found. Install it and run gh auth login.',
  '还没有登录 GitHub。执行 gh auth login 后再检查。':
    'Not signed in to GitHub. Run gh auth login, then check again.',
  '凭据已失效，请重新执行 gh auth login。': 'Credentials expired. Run gh auth login again.',
  '当前 token 缺少 notifications scope，@ 提醒会降级或不可用；可执行 gh auth refresh -s notifications。':
    'The token lacks the notifications scope; mentions will fall back or be unavailable. Run gh auth refresh -s notifications.',

  '核心能力': 'Core capability',
  '核心已支持 GitHub 来源': 'Core supports GitHub sources',
  '核心缺少 GitHub 来源能力': 'Core lacks GitHub source support',
  '未接入超级助理': 'Superagent not connected',
  '本地提示': 'Local notices',
  '关闭': 'Dismiss',
  '新消息会在右下角弹出提示，并计入待上报；接入超级助理后由核心接管通知。':
    'New messages pop up in the bottom-right corner and count as deferred; once Superagent is connected the core takes over notifications.',
  '信号会经核心回源确认后进入通知链路；来源关闭时不会落库。':
    'Signals enter the notification path after core-side source verification; nothing is stored while the source is off.',
  '当前核心缺少 github-source 能力，插件只采集候选、不向核心上报。升级 dsh-my-superagent 后重新加载插件即可补齐。':
    'This core lacks github-source support; the plugin only collects candidates and does not report them. Upgrade dsh-my-superagent and reload the plugin to catch up.',
  '来源状态': 'Source state',
  '运行中': 'Running',
  '采集但不推送': 'Collecting only',
  '等待开启': 'Waiting to be enabled',
  '已暂停': 'Paused',
  '来源在超级助理的「来源」页关闭时，信号不会落库；打开后下一轮自动补齐。':
    'When the source is off on the Superagent Sources page, signals are not stored; the next poll catches up after you enable it.',

  '维护仓库': 'Maintained repositories',
  '每行一个 owner/repo，最多 {max} 个。新 Issue 只提醒这些仓库。':
    'One owner/repo per line, up to {max}. New issues are only reported for these repositories.',
  '仓库列表': 'Repositories',
  '保存配置': 'Save settings',
  '已保存轮询配置': 'Polling settings saved',
  '失败退避': 'Backoff',
  '仓库名不合法：{repo}': 'Invalid repository: {repo}',
  '最多 {max} 个仓库': 'At most {max} repositories',

  '保存中…': 'Saving…',
  '来源': 'Source',
  '协议': 'Protocol',
  '信任级别': 'Trust',
  '类型': 'Kind',

  '轮询配置': 'Polling settings',
  '检查周期': 'Check interval',
  '当前周期：{interval}': 'Current: {interval}',
  '下一轮：{time}': 'Next poll: {time}',
  '检查周期（分钟）': 'Check interval (minutes)',
  '可设置 {min} 到 {max} 分钟，默认 5 分钟；实际间隔不会短于 GitHub 的 X-Poll-Interval。':
    'Between {min} and {max} minutes; default 5 minutes. The effective interval is never shorter than GitHub X-Poll-Interval.',
  '检查周期必须是数字': 'Interval must be a number',
  '检查周期需在 {min} 到 {max} 分钟之间': 'Interval must be between {min} and {max} minutes',

  '三路上报': 'Reported',
  '运行统计': 'Run stats',
  '轮询历史': 'Poll history',
  '最近 5 轮': 'Last 5 polls',
  '待评审 PR': 'Review requests',
  '新 Issue': 'New issues',
  '@ 提醒': '@ mentions',
  '拉取': 'Fetched',
  '上报': 'Reported',
  '去重': 'Deduplicated',
  '过滤': 'Filtered',
  '待上报': 'Deferred',
  '错误': 'Errors',
  '累计': 'Total',
  '最近轮询': 'Recent polls',
  '时间': 'Time',
  '成功': 'OK',
  '失败': 'Failed',
  '还没有轮询记录': 'No polls yet',
  '立即检查': 'Check now',
  '已触发一次检查': 'A check was triggered',
  '重置统计': 'Reset stats',
  '统计已重置': 'Stats reset',
  '操作失败：{error}': 'Action failed: {error}',

  '核心信号': 'Core signals',
  '总数': 'Total',
  '未找到超级助理数据库（dsh-my-superagent 未安装或尚未启动）':
    'Superagent database not found (dsh-my-superagent is not installed or not started)',
  '还没有落库信号': 'No signals stored yet',
  'ignored 表示回源未通过或来源关闭；admitted/digested 才会进入通知链路':
    'ignored means verification failed or the source is off; only admitted/digested enter notifications',
  '读取超级助理信号失败：{error}': 'Failed to read superagent signals: {error}',

  '插件只读 GitHub，不评审、不评论、不写回；评审与 Issue 分析由超级助理完成。':
    'This plugin only reads GitHub; it never reviews, comments, or writes back. Review and issue analysis are handled by Superagent.',
  '分钟': 'min',
  '秒': 's',
};

/** 中文映射就是键本身；显式注册可以让语言服务知道这些键属于本命名空间。 */
export const ZH: Record<string, string> = Object.fromEntries(Object.keys(EN).map((key) => [key, key]));

export function interpolate(text: string, values?: Record<string, unknown>): string {
  if (values === undefined) return text;
  return text.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined || value === null ? match : String(value);
  });
}

export function bindLocale(ctx: {
  effect?(execute: () => (() => void) | void, label?: string): unknown;
  locale?: {
    register?(ns: string, dictionaries: Record<string, Record<string, string>>): (() => void) | void;
    bind?(ns: string): ((text: string, values?: Record<string, unknown>) => string) | undefined;
  };
}): Translate {
  const fallback: Translate = (text, values) => interpolate(text, values);
  try {
    if (typeof ctx.locale?.register === 'function') {
      ctx.effect?.(() => {
        try {
          const unregister = ctx.locale?.register?.(NS, { zh: ZH, en: EN });
          return typeof unregister === 'function' ? unregister : undefined;
        } catch {
          // 同一插件的上一份实例还没释放命名空间时复用它。
          ctx.locale?.bind?.(NS);
          return undefined;
        }
      }, 'dsh-github-message: 文案');
      const bound = ctx.locale?.bind?.(NS);
      if (typeof bound === 'function') return (text, values) => interpolate(bound(text, values), values);
    }
  } catch {
    // 文案服务不可用时退回原文。
  }
  return fallback;
}
