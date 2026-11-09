# dsh-github-message

[English](https://github.com/xbzbing/dsh-github-message/blob/main/README.en.md) | 简体中文

`dsh-github-message` 是 [DSH（DeepSeek Harness）](https://github.com/deepseek-ai/dsh) 的一个消息来源插件：
用本机 `gh` 只读轮询 GitHub，把「待我评审的 PR」「我维护的仓库里新开的 Issue」「有人 @ 我」翻译成
`my-superagent/v1` 信号，交给 [dsh-my-superagent](https://github.com/xbzbing/dsh-my-superagent) 决定要不要打扰主人。

插件只做 **采集 → 翻译 → 上报**。评审、Issue 分析、评论写回、是否通知，全部由超级助理完成——
本仓库不包含任何写 GitHub 的代码。没有安装超级助理时，插件照常轮询，并把新消息显示在页面右下角。

## 安装

```bash
# 正式版（npm）
dsh plugin --profile web add dsh-github-message@latest

# 预发布（npm 的 stage 通道，版本号形如 0.1.0-stage.0）
dsh plugin --profile web add dsh-github-message@stage

# 或指定版本的 GitHub Release 附件
dsh plugin --profile web add https://github.com/xbzbing/dsh-github-message/releases/download/v0.1.0/dsh-github-message-0.1.0.tgz
```

仓库不提交 `lib/`，所以不能用 `dsh plugin add github:…` 直接安装，请用 npm 或 Release 附件。

首次安装后打开 **设置 → 插件 → GitHub 消息**：先确认「GitHub 登录」是绿色的（`gh auth status`），
再把要盯的仓库填进「维护仓库」。来源默认关闭，需要到超级助理的「来源」页打开 `github-message`。

更新时，只改了 client 端的版本刷新页面即生效；含 host 端改动的版本需要重装插件（`dsh plugin remove` 后再 `add`），
profile 没开 HMR 的话还要重启 dsh。

## 前提

- 本机已安装并登录 [GitHub CLI](https://cli.github.com/)：`gh auth status` 通过。
- 想看 `@` 提醒需要 `notifications` scope；缺失时自动降级为 search，面板会提示 `gh auth refresh -s notifications`。
- 想上报给超级助理：`dsh-my-superagent` 声明 `github-source`（P1 已实现）。旧核心自动进入 dry-run，只采集不推送。
- 兼容性：在 `dsh@0.2.2-rc.1` 上验证；Node.js ≥ 24.9（插件随 dsh 进程运行）。

## 功能

- **待评审 PR**：`review-requested:@me` 的 open PR，按 head 提交去重；同一 PR 推新 commit 才算新事实。
- **我仓库里的 PR**：开启 `prScope: owned` 后，还会按 `user:@me`、`orgs` 与仓库列表查询别人在我仓库开的 open PR，
  以 `github.pr.repo` 上报（作者是你自己的 PR 由自提流负责）。按 head 提交去重。
- **新 Issue**：默认只盯「维护仓库」列表；开启 `issueScope: owned` 后，还会按 `user:@me` 覆盖我名下的仓库，
  并逐个查询 `orgs` 里列出的组织。按创建时间提醒一次。
- **@ 提醒**：走 Notifications（`reason=mention|team_mention`），拿不到时降级为 `mentions:@me` 搜索；按评论 id 去重。
- **轮询节奏**：默认 5 分钟，可配 1 分钟～24 小时；实际间隔取配置与 GitHub `X-Poll-Interval` 的较大者，
  失败指数退避（最长 30 分钟），限流时等到 `X-RateLimit-Reset`。
- **本地提示**：未接入超级助理时，新消息在右下角弹卡片（最多 4 张、12 秒消失、可点开 GitHub）；
  每条只弹一次，记录写 `notified.json` 而不写 `seen`，之后接入核心仍会重新上报。
- **配置页**：登录状态、核心能力、仓库/组织列表、Issue 与 PR 范围、检查周期（共用一个保存按钮）、各路统计与核心信号；卡片可折叠。
- **中英双语**：跟随 DSH 语言设置。

## 信号契约

| kind | subject | sourceEventId | 触发 |
| --- | --- | --- | --- |
| `code-review.requested` | `github:<owner>/<repo>/pull/<n>` | `review:<repo>#<n>:<headSha>` | PR 请求我（或团队）评审 |
| `github.pr.opened` | `github:<owner>/<repo>/pull/<n>` | `self:<repo>#<n>:<headSha>` | 我自己提的 PR（核心按 `review.selfPr` 决定是否评审） |
| `github.pr.repo` | `github:<owner>/<repo>/pull/<n>` | `repo:<repo>#<n>:<headSha>` | 我名下仓库里别人开的 PR（`prScope=owned`；核心按 `review.repoPr` 决定是否评审） |
| `github.issue.opened` | `github:<owner>/<repo>/issues/<n>` | `issue:<repo>#<n>` | 仓库列表、自有仓库或组织仓库有新 Issue |
| `github.mention` | `github:<owner>/<repo>/issues/<n>` | `mention:<repo>#<n>:<commentId\|body>` | Issue/PR/评论里 @ 我或团队 |

- `repo` 在事件键中小写归一化，展示保留 GitHub 返回的大小写。
- 所有外部文本先去控制字符、压成单行并按字段截断；链接只接受 `https://github.com/...`。
- `payload` 只放展示/路由需要的字段，不放 raw API 响应、diff、邮箱、token。
- 插件以 `trust: 'external'` 注册，核心回源确认后才采纳。

## 权限与数据边界

- **只读 GitHub**：只用 `gh api` 的 GET / search / notifications，代码里没有任何 POST/PATCH/PUT/DELETE，
  也不调用 `gh pr review`、`gh pr comment`、`gh issue comment`。
- **不碰凭据**：不读、不写、不记录 token；`gh` 用自己的 keyring，子进程用最小环境，不传 `GH_TOKEN` / `GITHUB_TOKEN`。
- **不写回**：不评审、不评论、不合入、不 push。评审与 Issue 分析由超级助理完成。
- **本地文件**：只写插件自己的数据目录（`$DSH_HOME/dsh-github-message/`：`seen.json`、`notified.json`、
  `stats.json`、`config.json`、`poll.log`），权限 0700/0600。
- **核心数据库**：面板的「核心信号」只读 `$DSH_HOME/dsh-my-superagent/state.sqlite` 做统计，读不到就降级提示。

## 配置

默认值写在 `cordis.patch.yml` 与 `src/config.ts`。要覆盖时在 profile 的 `cordis.patch.yml` 里用同一个 id 追加
（patch 的 `config` 是整体替换，需要保留的键都要写上）：

```yaml
- id: dsh-github-message
  name: dsh-github-message
  config:
    intervalMs: 300000
    windowMs: 604800000
    issueScope: owned
    prScope: owned
    repos:
      - xbzbing/dsh-my-superagent
    orgs:
      - my-org
    mentionMode: notifications
```

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `intervalMs` | `300000`（5 分钟） | 轮询间隔；最小 60 秒，最大 24 小时。实际间隔取本值与 GitHub `X-Poll-Interval` 的较大者 |
| `windowMs` | `604800000`（7 天） | review/issue/mention 首轮与过滤窗口；`0` 表示不过滤 |
| `repos` | `[]` | 维护中的仓库列表，`owner/repo`；`issueScope=repos` 时 issue 流至少需要一个 |
| `issueScope` | `repos` | `repos` 只查仓库列表；`owned` 额外查 `user:@me` 与 `orgs`，仓库列表仍保留 |
| `prScope` | `review` | `review` 只查待我评审；`owned` 额外查 `user:@me`、`orgs` 与仓库列表里别人开的 PR |
| `orgs` | `[]` | 组织名列表，`issueScope=owned` 或 `prScope=owned` 时生效；逐个查 `org:<name>` |
| `maxRepos` | `10` | 单轮最多查多少个仓库（1–10） |
| `maxOrgs` | `10` | 单轮最多查多少个组织（1–10） |
| `maxResults` | `100` | 单流单轮最多处理多少条（1–100） |
| `maxPages` | `3` | 每个搜索最多翻几页（1–10） |
| `includeDrafts` | `true` | 是否提醒 draft PR |
| `mentionMode` | `notifications` | `notifications` / `search` / `off` |
| `timeoutMs` | `20000` | 单次 `gh` 调用超时 |
| `cliPath` | `gh` | 可用 `DSH_GITHUB_CLI` 覆盖 |
| `onStart` | `true` | 插件加载后是否立即轮询一次 |
| `stateFile` | `$DSH_HOME/dsh-github-message/seen.json` | 去重状态；`false` 只在内存 |
| `notifiedFile` | `$DSH_HOME/dsh-github-message/notified.json` | 本地提示记录；与去重分开，`false` 只在内存 |
| `seenTtlMs` | `7776000000`（90 天） | 去重与提示记录保留期 |
| `seenMaxEntries` | `20000` | 去重与提示记录上限 |
| `logFile` | `$DSH_HOME/dsh-github-message/poll.log` | 每轮摘要；`false` 关闭 |
| `statsFile` | `$DSH_HOME/dsh-github-message/stats.json` | 累计统计；`false` 只在内存 |
| `runtimeConfigFile` | `$DSH_HOME/dsh-github-message/config.json` | 面板保存的运行时配置；`false` 不持久化 |

面板保存的周期、仓库、Issue/PR 范围与组织列表写入 `config.json`，**优先于** Cordis patch；删掉该文件即可回到 patch 默认值。

## 开发

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # node --test "test/**/*.test.ts"
npm run build       # tsc host + esbuild client → lib/
npm run check       # typecheck + test + build
npm run smoke       # 真实只读 smoke（只查不改）
```

- 设计文档在 [docs/plan](docs/plan/)、决策记录在 [docs/adr](docs/adr/)、核心改动提案在
  [dsh-my-superagent issue #1](https://github.com/xbzbing/dsh-my-superagent/issues/1)。
- 测试用 fake `gh` 与 fake SourceService，不访问真实 GitHub；新增行为必须同时补测试。

## 发布

发布由 [`.github/workflows/release.yml`](.github/workflows/release.yml) 在「version bump 合入 main」时执行：

1. 门禁：`npm ci` → `npm run check` → `npm pack` → `scripts/assert-pack.mjs`；
2. 打 tag `v<version>`；
3. `npm publish --provenance --tag <latest|stage|rc>`（正式版走 `latest`，预发布走各自的 dist-tag）；
4. 创建 GitHub Release 并附上同一个 `.tgz`。正式版正文来自 `docs/releases/v<version>.md`，
   预发布先用 `.github/PRERELEASE_BODY.md` 建页，之后再 `gh release edit` 补完整变更记录。

正文格式见 [`.github/RELEASE_TEMPLATE.md`](.github/RELEASE_TEMPLATE.md)。npm 发布默认走 Trusted Publishing（OIDC），
在 npmjs.com 的包设置里把 `release.yml` 登记为 trusted publisher 即可，仓库不需要 `NPM_TOKEN`。

发版时 `package.json` 与 `src/constants.ts` 的 `PLUGIN_VERSION` 必须一起改，`test/version.test.ts` 会拦下不一致。

## License

[MIT](LICENSE)
