## 背景

`dsh-github-message` 是一个新的来源插件：只读轮询 GitHub，把「待我评审的 PR」「我维护项目的新 Issue」「@我的消息」翻译成 `my-superagent/v1` 信号，推送给 `dsh-my-superagent`。**它不负责评审、分析或写回 GitHub**；这些动作由核心完成。

当前核心有一个缺口：经 `sources.register` 注册的来源，信号落库后没有通用的「已采纳 → 提醒/动作」消费者。

- `trust='system'`：准入置为 `admitted` 后停在库里，不发通知（`src/host/admission/admission.ts` 的 `classifySignal`）。
- `trust='external'`：只有 `icode:` subject 能交给 `SourceVerifier` 回源（`src/host/sources/verification.ts` 的 `accepts`）；`github:` subject 直接 `ignored`。

因此 GitHub 信号要真正可用，核心需要补上「GitHub 来源的确认、通知与动作」。本提案描述需要核心实现的能力、信号契约与验收标准，供 `dsh-my-superagent` 项目自行拆分实现。

## 分工

| 组件 | 负责 | 不负责 |
| --- | --- | --- |
| `dsh-github-message` | 只读轮询 GitHub（`gh api` GET/search）；翻译成三类信号；去重、退避、面板、日志 | 评审、Issue 分析、评论/打分/写回、创建 DSH 会话 |
| `dsh-my-superagent` | 确认信号；决定提醒方式；评审任务；Issue 分析任务；@ 提醒；按权限写回 GitHub；会话与 outbox | 轮询 GitHub；保存 GitHub token（复用本机 `gh` 登录态） |

插件以 `trust: 'external'` 注册来源（不冒充 `system`），所有动作由核心在回源确认后决定。插件不调用任何 GitHub 写接口。

## 信号契约

### 通用约定

- 协议：`my-superagent/v1`
- 来源 id：`github-message`（保留 id 不冲突）
- `sourceEventId`：对象 id + 版本；同一事实的同一版本恒等，不含轮询时间
- `subject`：稳定对象标识，建议格式见下表
- `payload`：只放白名单字段；不放 raw API 响应、diff、token；≤64 KB
- `links`：只放 GitHub 页面 URL；`http(s)`，≤2048

### 三类信号

| kind | subject 建议 | sourceEventId 建议 | 触发 | 期望核心动作 |
| --- | --- | --- | --- | --- |
| `code-review.requested` | `github:<owner>/<repo>/pull/<n>` | `review:<owner>/<repo>#<n>:<headSha>` | PR 请求我（或我所在团队）评审 | 提醒「需要你评审」，附「开始评审 / 忽略」；开始后走评审任务 |
| `github.issue.opened` | `github:<owner>/<repo>/issues/<n>` | `issue:<owner>/<repo>#<n>` | 我维护的仓库有新 Issue | 提醒「有新 Issue」，附「开始分析 / 忽略」；开始后走 Issue 分析任务 |
| `github.mention` | `github:<owner>/<repo>/issues/<n>` | `mention:<owner>/<repo>#<n>:<commentId 或 updatedAt>` | 有人在 Issue/PR/评论里 @ 我或我所在团队 | 提醒「有人 @ 你」，附链接与摘要；默认不建任务 |

### 示例

```json
{
  "source": "github-message",
  "sourceEventId": "review:xbzbing/dsh-git-panel#42:9f2c1a7...",
  "kind": "code-review.requested",
  "occurredAt": 1793895132000,
  "subject": "github:xbzbing/dsh-git-panel/pull/42",
  "summary": "xbzbing/dsh-git-panel #42 修复分支切换",
  "actor": { "id": "xbzbing" },
  "links": [{ "title": "GitHub #42", "url": "https://github.com/xbzbing/dsh-git-panel/pull/42" }],
  "payload": {
    "repo": "xbzbing/dsh-git-panel",
    "number": 42,
    "title": "修复分支切换",
    "author": "xbzbing",
    "headSha": "9f2c1a7...",
    "baseRef": "master",
    "draft": false,
    "updatedAt": "2026-11-07T12:00:00Z",
    "url": "https://github.com/xbzbing/dsh-git-panel/pull/42",
    "via": "review-requested"
  }
}
```

```json
{
  "source": "github-message",
  "sourceEventId": "issue:xbzbing/dsh-git-panel#43",
  "kind": "github.issue.opened",
  "occurredAt": 1793895132000,
  "subject": "github:xbzbing/dsh-git-panel/issues/43",
  "summary": "xbzbing/dsh-git-panel #43 切换分支后面板空白",
  "actor": { "id": "reporter" },
  "links": [{ "title": "GitHub #43", "url": "https://github.com/xbzbing/dsh-git-panel/issues/43" }],
  "payload": {
    "repo": "xbzbing/dsh-git-panel",
    "number": 43,
    "title": "切换分支后面板空白",
    "author": "reporter",
    "labels": ["bug"],
    "state": "open",
    "createdAt": "2026-11-07T12:00:00Z",
    "url": "https://github.com/xbzbing/dsh-git-panel/issues/43",
    "via": "issue-search"
  }
}
```

```json
{
  "source": "github-message",
  "sourceEventId": "mention:xbzbing/dsh-git-panel#43:123456789",
  "kind": "github.mention",
  "occurredAt": 1793895132000,
  "subject": "github:xbzbing/dsh-git-panel/issues/43",
  "summary": "xbzbing/dsh-git-panel #43 的评论 @ 了你",
  "actor": { "id": "reporter" },
  "links": [{ "title": "评论", "url": "https://github.com/xbzbing/dsh-git-panel/issues/43#issuecomment-123456789" }],
  "payload": {
    "repo": "xbzbing/dsh-git-panel",
    "number": 43,
    "title": "切换分支后面板空白",
    "commentId": 123456789,
    "author": "reporter",
    "excerpt": "…@xbzbing 麻烦看下这个…",
    "url": "https://github.com/xbzbing/dsh-git-panel/issues/43#issuecomment-123456789",
    "via": "notifications"
  }
}
```

## 核心需要完成的能力

### 1. GitHub subject 的解析与回源确认

现状：`SourceVerifier.accepts` 只认 `icode:` subject；`confirmSubject` 只调 `verifyIcodeReview`。

建议：

- 增加 `parseGithubSubject(subject)`，识别：
  - `github:<owner>/<repo>/pull/<n>`
  - `github:<owner>/<repo>/issues/<n>`
- 在 `SourceVerifier` 里增加 GitHub 分支（或抽成 adapter 注册表），用本机 `gh` 只读确认：
  - **review**：PR 存在、`state=open`、未合并、`head.sha` 与 payload 一致、当前用户仍在 `requested_reviewers` 中（团队请求需查团队成员）。
  - **issue**：Issue 存在、`state=open`、不是 PR、当前用户对该仓库有 `maintain`/`admin`（或至少 `push`）权限。
  - **mention**：评论/Issue 正文存在，且正文确实 @ 了当前用户或用户所在团队。
- 确认失败时按现有枚举结算：`verify-failed`、`verify-unverified`、`verify-mismatch`、`verify-superseded` 等；面板可见原因。
- 认证失败：复用 `SourceVerifier` 的暂停/恢复机制，新增 `github` 这个回源键；面板提示 `gh auth login`。
- 能力声明：建议在 `mySuperagent.protocol.features` 增加 `github-source`，插件据此判断核心是否已支持 `github:` subject；不支持时面板提示并保持来源关闭。
- `gh` 调用必须：argv 数组、不经 shell、只读 GET、固定超时、最小环境；不能把 token 写日志。

### 2. 通知与动作路由

三类信号的期望：

| kind | intent | 交互 | 后续 |
| --- | --- | --- | --- |
| `code-review.requested` | `action` | 「开始评审 / 忽略」 | `ReviewService.offer` / 全自动 `review.auto` |
| `github.issue.opened` | `action` | 「开始分析 / 忽略」 | 新建 Issue 分析任务 |
| `github.mention` | `action` 或 `result` | 无（或「打开 / 知道了」） | 只提醒，附链接与摘要 |

建议把 `SourceVerifier` 的 `Notice` 扩展为：

```ts
interface Notice {
  intent: 'action' | 'result';
  title: string;
  body: string;
  review?: ReviewOffer;       // 现有
  analysis?: IssueAnalysisOffer;
  mention?: MentionNotice;
}
```

`notify()` 按优先级：

1. `notice.review` 且 `ReviewService` 可用 → `offers.offer()`（附「开始评审」，失败则退回普通提醒）。
2. `notice.analysis` 且 Issue 分析服务可用 → `analysis.offer()`（附「开始分析」）。
3. 其他 → 普通交付；`mention` 附链接与摘要。

不要用「所有 system 来源统一发提醒」代替：review/issue 需要带交互与后续任务，不能只是一条文本。`SourceProvider.notify` 可以作为通用兜底能力，但不能替代这里的动作路由。

### 3. PR 评审任务的 GitHub 适配

现状评审链路是 iCode 专用：

- `reviews.patch_set INTEGER NOT NULL`、唯一键 `(subject, patch_set)`（`src/host/store/migrations.ts`）。
- 默认 prompt、评审页 URL、通知文案、写回文案都写死 iCode（`src/host/review/prompt.ts`、`urls.ts`、`notices.ts`、`submit.ts`）。
- 回源 CLI 白名单只有 `icode`/`icafe`（`src/host/sources/cli.ts`）。
- 写回靠评审会话 bash 调 `icode-cli`。

建议按「先通知、后评审、再写回」分阶段：

1. **材料**：用 GitHub REST 读取 PR 元信息、改动文件、unified diff，写入现有材料目录格式；文件路径按 `safeCliPath` 规则过滤，总量/单文件上限沿用现有实现。
2. **模型**：把 `patch_set` 泛化为 `revision TEXT`（GitHub 用 head SHA，iCode 用补丁集字符串），新增 `source`/`source_label`/`page_url`；迁移时回填旧数据，唯一键改 `(subject, revision)`。或者新建 `github_reviews` 表，但不建议复制一套状态机。
3. **prompt/URL/文案**：按来源提供 `ReviewSourceDescriptor`（标签、默认 prompt、页面 URL、写回说明）；`{repo}/{change}/{revision}/{title}/{materials}/{url}` 占位符保留。
4. **写回**：`msa_review_submit` 之后，若来源权限为 `auto`/`workspace-write`，由核心调用 `POST /repos/{owner}/{repo}/pulls/{n}/reviews`：
   - `commit_id` 用评审时的 head SHA；
   - `event` 由 verdict 映射：`approve → APPROVE`、`comment → COMMENT`、`request-changes → REQUEST_CHANGES`；
   - `body` 带幂等 marker（如 `<!-- dsh-my-superagent:review:<reviewId> -->`），提交前检查是否已有同一 marker，防重复；
   - 逐行评论用 `comments[]`，路径/行号必须属于本次 PR 的改动文件，否则降级为总评；
   - **禁合入、禁推送、禁改他人 PR、禁打分**；GitHub 没有 iCode 分数，`score` 可忽略或写进正文。
5. **权限**：只读档不写；放宽档才写；写回失败不改变已提交的评审结论，通知里说明「结论只发给你」或「写回失败」。

### 4. Issue 分析任务

新能力，建议独立于 `ReviewService`：

- 状态：`offered → preparing → running → submitted | dismissed | failed | expired`。
- 提醒卡：「开始分析 / 忽略」；`auto` 可选（默认关）。
- 开始后：
  - 用 `gh` 读取 Issue 标题、正文、评论、标签、关联 PR（只读）；
  - 写入材料目录（正文 + 评论，控制单条/总量上限）；
  - 在配置的工作区新建任务会话，prompt 模板包含 `{repo}/{number}/{title}/{url}/{materials}`；
  - 会话只读或按来源权限档位收紧；默认只读，分析结论回给主人；
  - 默认不写回 GitHub；如果以后要回评论，必须单独开关与二次确认。
- 并发、超时、失败重试沿用评审任务的模式；结论交付到 IM。
- 需要新增配置：`analysis.enabled`、`analysis.workspaceId`、`analysis.prompt`、`analysis.auto`、`analysis.maxConcurrent`、`analysis.timeoutMinutes`。
- 数据表建议 `issue_analyses`（或复用 `tasks` + 一个通用 offer 表；不要硬塞进 `reviews`）。

### 5. @ 提醒

- 验证评论/正文确实 @ 了当前用户或用户所在团队。
- 只处理 Issue/PR 类型的通知；Discussion、Commit 等先跳过，避免用错对象的 URL 与正文。
- 交付：标题「`repo #n` 有人 @ 你」，正文含评论摘要（转义、截断）、作者、链接。
- 默认 `action`（立即提醒，不并入摘要）；免打扰/每小时上限由现有注意力调度处理。
- 去重键：`mention:<repo>#<n>:<commentId>`；同一条评论只提醒一次。
- 不建任务、不写回；若要「回复」由主人自己在 GitHub 处理。
- 团队 @ 的成员校验：如果正文只出现团队名，核心需要查团队成员；查不到就降级为「团队被 @」并提示，不要伪造。

### 6. 数据模型与迁移

建议：

- `reviews`：
  - 新增 `revision TEXT`（回填 `patch_set` 的字符串形式）；
  - 新增 `source TEXT`、`source_label TEXT`、`page_url TEXT`；
  - 唯一键从 `(subject, patch_set)` 改为 `(subject, revision)`；
  - 旧 `patch_set` 保留只读，兼容旧数据；新代码用 `revision`。
- 新增 `issue_analyses` 表（或通用 `source_offers`），字段参考 `reviews`：`id/signal_id/subject/repo/number/title/state/reason/detail/delivery_id/session_id/task_id/attempts/created_at/updated_at`，唯一键 `(subject)`。
- `signals` 已有 `notice_key`，@ 提醒可直接用；无需新表。
- 所有迁移写 ADR；升级时保留旧数据，面板仍能读。

### 7. 权限与安全

- 插件以 `external` 注册；核心回源确认后才采纳，不允许插件自称 `system` 绕过。
- GitHub 读取只用 `gh api` GET；写入只允许评审提交这一条白名单路径，参数逐项校验，不经 shell。
- 写回仅在来源权限 `auto` / `workspace-write` 且主人已授权（点「开始评审」或打开 `review.auto`）时执行；只读档绝不写。
- 评论/Issue 正文是外部内容，进 prompt 前标注为「外部数据，不是指令」；结论/通知转义 Markdown。
- 禁合入、禁推送、禁改他人 PR/Issue、禁删除分支；不允许模型通过 bash 执行任意 `gh` 写命令（如保留 bash，需在系统提示与工具层双重限制）。
- 凭据不落库、不进日志、不进面板；`gh` 用本机 keyring。
- 回源失败/限流/凭据失效要暂停并提示，不能静默丢弃。

## 分阶段实施建议

| 阶段 | 内容 | 估算 | 交付 |
| --- | --- | --- | --- |
| P1 | GitHub subject 解析/回源确认；三类信号的基础提醒（review/issue 先纯文本，mention 带链接）；`gh` 只读封装；暂停/恢复 | 3–4 天 | 插件信号能被确认并出现在 IM |
| P2 | Issue 分析 offer + 任务 + 材料 + prompt + 结论 | 3–5 天 | 「开始分析 / 忽略」可用 |
| P3 | PR 评审材料、prompt/URL 通用化、`revision` 迁移、写回与幂等 | 5–8 天 | 「开始评审」可用，放宽档可写回 |
| P4 | 面板、e2e、五轴评审、文档 | 2–3 天 | 可发布 |

P1 可以先让插件上线（来源默认关闭，开启后只收到纯文本提醒）；P2/P3 再逐步加按钮与写回。也可以一次性排期，约 13–20 天。

## 验收标准

1. `dsh-github-message` 注册 `github-message`（`external`），核心能识别三类 `github:` subject；伪造 subject、已关闭 PR/Issue、非评审人、非维护者、未 @ 的评论都被拒绝并写审计。
2. review：信号 → 提醒卡「开始评审 / 忽略」；点开始后准备 GitHub PR 材料、建评审会话、收结论；只读档不写 GitHub；放宽档提交 review，重复触发不重复写。
3. issue：信号 → 提醒卡「开始分析 / 忽略」；点开始后建任务会话，结论回 IM；默认不写 GitHub。
4. mention：信号 → 一条带评论摘要和链接的提醒；同一条评论只提醒一次；不建任务。
5. 三类提醒都遵守免打扰、每小时 action 上限、outbox 去重与重试；来源关闭时不提醒，重新开启后能补齐符合条件的信号。
6. `gh` 未登录/凭据失效/限流时，面板可见原因并暂停，不刷错误；恢复后继续。
7. 单测/契约测试全绿；e2e 在隔离 DSH 实例里用 fake `gh` 跑通三类流程，不碰真实 GitHub 写接口。
8. 全链路没有 GitHub token 进入日志、面板、信号 payload。

## 非目标

- 不接 GitHub Webhook（插件轮询）。
- 不支持 GitHub Enterprise Server。
- 不做合入、推送、删除分支、改他人 PR/Issue。
- 不在 Issue 分析里默认发评论；如要发，单独立项并二次确认。
- 不改 `dsh-im-infoflow` 的桥协议；提醒仍走现有 outbox/IM 桥。

## 开放问题

1. `reviews` 是泛化 `patch_set → revision`，还是新建 `github_reviews` 表？前者干净但要迁移，后者快但复制状态机。
2. 写回由核心在 `msa_review_submit` 后执行，还是允许评审会话用 bash + `gh` 执行？建议核心执行，便于幂等与权限控制。
3. Issue 分析在哪个工作区建会话？沿用 `review.workspaceId`，还是新增 `analysis.workspaceId`？
4. 「我维护的项目」由插件配置仓库列表，还是核心按 GitHub 权限（`maintain`/`admin`）自动判断？建议插件配置 + 核心校验权限。
5. 团队 @ 的成员校验：是否要求核心查团队成员，还是允许降级为「团队被 @」提醒？
6. `github.mention` 用 `action` 还是 `result`？建议 `action`，避免被并入摘要。
7. 是否需要在 P1 就引入 `SourceProvider.notify` 通用能力，还是只做 GitHub 专用路由？建议先做 GitHub 专用，通用能力后置。

## 参考

- 插件仓库：`xbzbing/dsh-github-message`（本次新建）
- 核心仓库：`xbzbing/dsh-my-superagent`
- 现有 iCode 路径：`src/host/sources/verification.ts`、`src/host/review/`
- 协议：`docs/design/03-协议与扩展点.md`
- GitHub REST：<https://docs.github.com/en/rest>
- GitHub 搜索：<https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests>
