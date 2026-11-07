# AGENTS.md — dsh-github-message

## 这个项目是什么

`dsh-github-message` 是 [dsh-my-superagent](../dsh-my-superagent) 的一个**消息来源插件**：
用本机 `gh` 只读轮询 GitHub，把三类事实翻译成 `my-superagent/v1` 信号。

1. **review**：待我评审的 PR（`review-requested:@me`）。
2. **issue**：我维护的仓库里新开的 Issue，提醒主人「是否分析」。
3. **mention**：有人 @ 我或我所在的团队。

插件只做「采集 → 翻译 → 上报」。**评审、Issue 分析、评论/写回、决定要不要打扰主人，全部由
`dsh-my-superagent` 完成。** 本仓库不包含任何写 GitHub 的代码。

设计文档：

- [docs/plan/01-可行性研究与开发计划.md](docs/plan/01-可行性研究与开发计划.md)
- [docs/plan/02-开发计划-三路提醒.md](docs/plan/02-开发计划-三路提醒.md)
- [docs/adr/](docs/adr/)：重要决策记录
- 核心改动提案：[dsh-my-superagent issue #1](https://github.com/xbzbing/dsh-my-superagent/issues/1)

本地调研、临时记录、个人脚本一律放 `docs/local/`（已 gitignore），不要入仓。

## 不可违反的边界

- **只读 GitHub**：只允许 `gh api` 的 GET/search/notifications；代码里不能出现
  `-X POST/PATCH/PUT/DELETE`、`gh pr review`、`gh pr comment`、`gh issue comment`。
- **不保存凭据**：不读 token、不写 token、不把 token 放进日志或信号 payload。
  `gh` 用 keyring；子进程用最小环境，不传 `GH_TOKEN` / `GITHUB_TOKEN`。
- **不直接修改 `dsh-my-superagent`**：核心需要改的地方写成 issue 提案，由核心项目实现。
  本仓库可以读取它的协议文档和数据库，但不能编辑它的源码。
- **信任级别固定为 `external`**：不得声明 `system` 来绕过核心的回源确认。
- **只推送信号**：不评审、不分析、不发评论、不打分、不合入、不 push。
- **来源默认关闭**：仓库关闭时 `emit` 返回 `source-disabled`，不写 `seen`，下一轮重试。

## 架构

```text
GitHub API (gh api, read-only)
  ├─ search/issues: review-requested:@me
  ├─ search/issues: repo:<owner>/<repo> is:issue created:>=
  └─ notifications: reason=mention|team_mention（降级 search mentions:@me）
        │
        ▼
src/poller.ts  三路独立编排、过滤、去重、统计
        │  emit(SignalDraft)
        ▼
dsh-my-superagent  sources.register({ id: 'github-message', trust: 'external', kinds })
```

### 信号契约

| kind | subject | sourceEventId |
| --- | --- | --- |
| `code-review.requested` | `github:<owner>/<repo>/pull/<n>` | `review:<repo>#<n>:<headSha>` |
| `github.issue.opened` | `github:<owner>/<repo>/issues/<n>` | `issue:<repo>#<n>` |
| `github.mention` | `github:<owner>/<repo>/issues/<n>` | `mention:<repo>#<n>:<commentId>` |

- `repo` 在事件键中小写归一化，展示用 GitHub 返回的原始大小写。
- 所有外部文本先去控制字符、压成单行、按字段截断；链接只接受 `https://github.com/...`。
- `payload` 只放展示/路由需要的字段，不放 raw API 响应、diff、邮箱、token。

### 核心能力探测

注册时读取 `mySuperagent.protocol.features`：

- 含 `github-source`：正常上报。
- 不含：进入 **dryRun**，照常采集和展示候选，但**不 emit、不写 seen**；面板提示核心尚未支持
  并给出 issue #1 链接。这样核心升级后能补齐当前仍然符合条件的事实，不会因提前写 seen 而漏报。

## 技术约束

- Node.js ≥ 24.9，ESM，TypeScript strict。
- `erasableSyntaxOnly`：不用 enum、namespace、参数属性。
- 相对导入必须带 `.ts` 后缀（`rewriteRelativeImportExtensions`）。
- **零运行时依赖**；React 只在 client 半、由宿主提供。
- 一个文件尽量 ≤ 500 行；超过就按职责拆。
- 禁止 `any`；外部 JSON 一律先当 `unknown` 再逐字段收窄。
- 子进程用 argv 数组、`shell: false`，不拼 shell 字符串。
- 所有仓库名、编号、SHA、URL 使用前校验。

## 命令

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # node --test "test/**/*.test.ts"
npm run build       # tsc host + esbuild client → lib/
npm run check       # typecheck + test + build
```

真实只读 smoke（不创建/修改任何 GitHub 资源）：

```bash
gh auth status
gh api user --jq .login
gh api 'search/issues?q=is%3Apr%20is%3Aopen%20review-requested%3A%40me&per_page=1'
gh api 'notifications?all=true&per_page=1' --include
```

## 开发方式

- **DDD + TDD**：先写契约/用例，再实现；测试用 fake `gh`、fake SourceService，不访问真实 GitHub。
- 每个流（review/issue/mention）独立失败、独立统计；单条坏数据不能中断整轮。
- 新增行为必须同时补测试；`npm run check` 全绿才算完成。
- 重要决策写 ADR（`docs/adr/NNNN-标题.md`，状态/日期/背景/决策/代价/相关），不要只留在对话里。
- 提交信息用 Conventional Commits，正文中文；按功能/模块拆分提交，不写超大变更；只做本地提交，不 push。
- 若干功能完成后，用隔离上下文的 `code-review-and-quality` 五轴评审；不修的结论写到
  `docs/review/` 并说明理由。

## 已知依赖

- 核心支持 `github:` subject 与 `github-source` feature 之前，信号不会进入通知链路；
  这是核心侧的准入限制，不是插件故障。
- 面板的「核心信号」统计只读 `$DSH_HOME/dsh-my-superagent/state.sqlite`，读不到就降级。
