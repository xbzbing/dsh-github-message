// host 与 client 共用的常量。这个文件不能 import 任何 Node 或浏览器模块，
// 两端都会把它打进各自的产物。

export const PACKAGE_NAME = 'dsh-github-message';
export const PLUGIN_VERSION = '0.1.0';

/** host 面板 RPC 路由：/api/dsh-github-message。 */
export const RPC_PATH = 'dsh-github-message';
/** host/client 的契约版本；两边不一致时面板直接提示重装。 */
export const HOST_CONTRACT = 4;

export const SOURCE_ID = 'github-message';
export const PROTOCOL = 'my-superagent/v1';

export const KIND_REVIEW = 'code-review.requested';
export const KIND_ISSUE = 'github.issue.opened';
export const KIND_MENTION = 'github.mention';
/** 自己提的 PR（ADR-0087）：由核心按 review.selfPr 决定要不要评审。 */
export const KIND_SELF = 'github.pr.opened';
/** 自有仓库里别人开的 PR（ADR-0007）：独立 kind，由核心的 review.repoPr 把关。 */
export const KIND_REPO = 'github.pr.repo';
export const KINDS = [KIND_REVIEW, KIND_ISSUE, KIND_MENTION, KIND_SELF, KIND_REPO] as const;

/**
 * 核心声明的可选能力。旧核心缺这个 feature 时插件只采集不 emit，
 * 避免先把事实写进 seen、等核心升级后反而漏报。
 */
export const REQUIRED_FEATURE = 'github-source';

/** 设置页槽位与插件页包配置槽位。 */
export const SLOT_NAME = 'settings.section';
export const BUNDLE_CONFIG_SLOT = 'plugins.bundle.config';
export const PANEL_ID = 'dsh-github-message';

/** 面板打开期间的状态刷新间隔。 */
export const REFRESH_INTERVAL_MS = 10_000;

/** 周期输入框的边界（分钟），与 host 的 1 分钟～24 小时对应。 */
export const MIN_CLIENT_INTERVAL_MINUTES = 1;
export const MAX_CLIENT_INTERVAL_MINUTES = 1440;
