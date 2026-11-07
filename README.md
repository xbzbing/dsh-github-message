# dsh-github-message

把 GitHub 上「待我评审的 PR」「我维护项目的新 Issue」「@ 我或我所在团队的消息」接成
[dsh-my-superagent](../dsh-my-superagent) 的数据来源，并带一个 Web 配置页。

- 只用本机 `gh` 的只读 API（GET/search/notifications），不需要 Webhook，不需要公网回调地址。
- 只做**采集 → 翻译 → 上报**；评审、Issue 分析、评论/写回、是否打扰主人全部由 `dsh-my-superagent` 完成。
- 三类信号都以 `trust: 'external'` 注册，核心回源确认后才采纳。
- 默认每 **5 分钟**检查一次；同一 PR 的同一 head SHA、同一 Issue、同一条评论只上报一次。
- 核心尚未支持 `github:` subject 时进入 dry-run：照常采集候选，但不向核心上报、不写去重状态。

## 前置条件

1. 安装 [GitHub CLI](https://cli.github.com/)：`brew install gh`（macOS）。
2. 登录：`gh auth login`。
3. 确认 token 有读权限：

```bash
gh auth status
gh api user --jq .login
```

`repo` 或 `notifications` scope 任一存在即可读 Notifications；只有 `repo` 时私有仓库也能读。
两者都没有时，mention 流会自动降级为 `search mentions:@me`。如果 @ 提醒需要精确到评论，可执行：

```bash
gh auth refresh -s notifications
```

插件不读取、不保存 token，`gh` 自己使用 keyring；子进程也不会收到 `GH_TOKEN` / `GITHUB_TOKEN`。

## 安装

```bash
cd /Users/ankh/workspace/private/dsh-plugins/dsh-github-message
npm install
npm run build

# 先卸载旧版本，等 host 完成重载（约 15 秒）再安装
dsh plugin --profile web remove dsh-github-message
sleep 15
dsh plugin --profile web add file:/Users/ankh/workspace/private/dsh-plugins/dsh-github-message
```

安装后插件层会自动 `insert` 一个 `dsh-github-message` 条目。宿主里没有 `mySuperagent`
服务时插件照常加载，只是不注册来源；面板仍可查看登录、仓库与统计。

打开 **设置 → 插件 → GitHub 消息**，或在侧栏 **插件** 页的已安装列表里打开本包的配置卡。
新增 client 半后如果页面没有立刻出现，请刷新 DSH Web 页面。

更新版本时先卸载再安装，不需要重启 dsh：

```bash
npm run build
dsh plugin --profile web remove dsh-github-message
sleep 15
dsh plugin --profile web add file:/Users/ankh/workspace/private/dsh-plugins/dsh-github-message
```

## 面板

client 半注册在 `settings.section` 和 `plugins.bundle.config` 两个槽位，文案跟随 DSH 语言设置：

- **GitHub 登录**：账号、token 来源、scopes、通知权限、API 探测结果；点「检查登录」立即重查。
- **核心能力**：核心是否声明 `github-source`。缺失时显示 issue #1 链接，并说明当前只采集、不推送。
- **维护仓库**：每行一个 `owner/repo`，保存后立即生效；issue 流只提醒这些仓库。
- **检查周期**：当前周期、下一轮时间、失败退避；按分钟修改并保存。
- **三路统计**：review / issue / mention 各自的上报、去重、过滤、待上报、错误；最近 5 轮摘要。
- **核心信号**：只读 `$DSH_HOME/dsh-my-superagent/state.sqlite`，按 kind/state 统计
  `source='github-message'` 的信号；读不到时降级提示。
- **操作**：立即检查、重置统计。

面板保存的周期与仓库列表写入 `$DSH_HOME/dsh-github-message/config.json`，**优先于**
Cordis patch 里的 `intervalMs` / `repos`。要恢复 patch 默认值，删除这个文件后重新加载插件。

## 信号契约

| kind | subject | sourceEventId | 触发 |
| --- | --- | --- | --- |
| `code-review.requested` | `github:<owner>/<repo>/pull/<n>` | `review:<repo>#<n>:<headSha>` | PR 请求我（或团队）评审 |
| `github.issue.opened` | `github:<owner>/<repo>/issues/<n>` | `issue:<repo>#<n>` | 维护仓库有新 Issue |
| `github.mention` | `github:<owner>/<repo>/issues/<n>` | `mention:<repo>#<n>:<commentId>` | Issue/PR/评论里 @ 我或团队 |

- `repo` 在事件键中小写归一化，展示保留 GitHub 返回的大小写。
- 所有外部文本去控制字符、压成单行并按字段截断；`links` 只放 `https://github.com/...`。
- `payload` 只放展示/路由需要的字段，不放 raw API 响应、diff、邮箱、token。
- 同一 PR 推新 commit（head SHA 变化）才算新事实；只改标题/描述不重复提醒。

## 去重

1. **事件键**：PR 用 head SHA，Issue 用编号，@ 用 comment id（没有 id 时用 `updated_at`）。
2. **本轮内**：同一个事件键只 emit 一次。
3. **跨轮询**：核心按 `(source, sourceEventId)` 幂等吸收；插件再把已接受的键写进 `seen.json`，重启后也不会重报。
4. **来源关闭**：`emit` 返回 `source-disabled` 时不写 `seen`，下一轮自动重试。
5. **dry-run**：核心未声明 `github-source` 时完全不 emit、不写 `seen`，核心升级后能补齐当前事实。
6. **mention 游标**：只有上一轮真正处理完（非 dry-run、来源已开启、无错误）才推进 `since`/ETag；否则用完整窗口重扫。

## 配置

默认值写在 `cordis.patch.yml` 与 `src/config.ts`。其余配置在 profile 的
`~/.dsh/profiles/web/cordis.patch.yml` 里用同一个 id 追加：

```yaml
- id: dsh-github-message
  name: dsh-github-message
  config:
    intervalMs: 300000
    windowMs: 604800000
    repos:
      - xbzbing/dsh-git-panel
      - xbzbing/dsh-my-superagent
    mentionMode: notifications
```

> patch 的 `config` 是整体替换，不是按字段合并。写了这段就把需要保留的键都写上；
> 没写的键回落到 `src/config.ts` 里的默认值。

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `intervalMs` | `300000` | 轮询间隔；最小 60 秒，最大 24 小时 |
| `windowMs` | `604800000`（7 天） | review/issue/mention 首轮与过滤窗口；`0` 表示不过滤 |
| `repos` | `[]` | 维护中的仓库列表，`owner/repo`；issue 流必填 |
| `maxRepos` | `10` | 单轮最多查多少个仓库（1–50） |
| `maxResults` | `100` | 单流单轮最多处理多少条（1–100） |
| `maxPages` | `3` | 每个搜索最多翻几页（1–10） |
| `includeDrafts` | `true` | 是否提醒 draft PR |
| `mentionMode` | `notifications` | `notifications` / `search` / `off` |
| `timeoutMs` | `20000` | 单次 `gh` 调用超时 |
| `cliPath` | `gh` | 可用 `DSH_GITHUB_CLI` 覆盖 |
| `onStart` | `true` | 插件加载后是否立即轮询一次 |
| `stateFile` | `$DSH_HOME/dsh-github-message/seen.json` | 去重状态；`false` 只在内存 |
| `seenTtlMs` | `7776000000`（90 天） | 去重记录保留期 |
| `seenMaxEntries` | `20000` | 去重记录上限 |
| `logFile` | `$DSH_HOME/dsh-github-message/poll.log` | 每轮摘要；`false` 关闭 |
| `statsFile` | `$DSH_HOME/dsh-github-message/stats.json` | 累计统计；`false` 只在内存 |
| `runtimeConfigFile` | `$DSH_HOME/dsh-github-message/config.json` | 面板保存的运行时配置；`false` 不持久化 |

## 核心能力门禁

插件注册时读取 `mySuperagent.protocol.features`：

- 含 `github-source`：正常上报。
- 不含：进入 **dry-run**，面板显示「采集但不推送」，不 emit、不写 `seen`。
  核心支持后重新加载插件即可补齐当前仍然符合条件的 review/issue/mention。

核心侧的确认、通知与动作路由由
[dsh-my-superagent issue #1](https://github.com/xbzbing/dsh-my-superagent/issues/1) 实现；
这是核心的准入限制，不是本插件故障。

## 验证

- 面板：设置 → 插件 → GitHub 消息；侧栏插件页的本包配置卡。
- 轮询摘要：`$DSH_HOME/dsh-github-message/poll.log`，每行一个 JSON，含三路 fetched/emitted/duplicates/errors。
- 去重状态：`$DSH_HOME/dsh-github-message/seen.json`。
- 累计统计：`$DSH_HOME/dsh-github-message/stats.json`。
- 面板保存的配置：`$DSH_HOME/dsh-github-message/config.json`。
- 核心信号落库：

```bash
node --input-type=module -e '
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.env.DSH_HOME + "/dsh-my-superagent/state.sqlite", { readOnly: true });
console.table(db.prepare("select kind, state, count(*) as n from signals where source = ? group by kind, state").all("github-message"));
'
```

### 真实只读 smoke

```bash
npm run build
node scripts/smoke.mjs
DSH_SMOKE_REPOS=xbzbing/dsh-my-superagent node scripts/smoke.mjs
```

只读取登录、review、issue、mention，不创建/修改任何 GitHub 资源，不写插件状态。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 面板「未安装 gh」 | 安装 GitHub CLI，确认 `gh --version` 可用 |
| 「凭据失效」/ API 401 | `gh auth login` 后点「检查登录」 |
| 通知权限「缺失」 | `gh auth refresh -s notifications`，或把 `mentionMode` 设为 `search` |
| 核心能力「尚未支持」 | 核心 issue #1 尚未合入；插件保持 dry-run，不会误写 seen |
| 来源状态「等待开启」 | 到超级助理的「来源」页打开 `github-message` |
| 一直无候选 | 检查 `repos`、`windowMs`、`gh auth status`；看 `poll.log` 的 errors |
| 轮询变慢 | 面板显示退避时间；通常是限流或网络错误，恢复后自动重置 |

## 开发

```bash
npm install
npm run check   # typecheck + 单测 + 构建 host 与 client
npm run smoke   # 真实只读 smoke
```

构建产物：

- `lib/index.js` + `lib/src/*.js`：host 半，`tsc` 编译。
- `lib/client.js`：client 半，`esbuild` 打包成单文件，外层是 `window.__ModuleLoader__.load({ id, factory })`。
- `locale/zh.json`、`locale/en.json`：插件管理页的标题/描述。

重要决策记录在 [docs/adr](docs/adr)；本地调研与临时记录放 `docs/local/`（已 gitignore）。

## 安全边界

- 只调用 `gh api` 的 GET/search/notifications；代码中没有 `-X POST/PATCH/PUT/DELETE`、
  `gh pr review`、`gh pr comment`、`gh issue comment`。
- 仓库名、PR/Issue 编号、SHA、API URL 使用前校验。
- 子进程用 argv 数组、`shell: false`；只传运行 `gh` 所需的最小环境。
- 不读取、不保存、不记录 token；日志里只有账号、状态与计数。
