# Release notes template

本文件是**正式版** GitHub Release 正文的**唯一格式来源**。发版时照抄下面的骨架填写，不要翻历史 release 反推格式。

- Release 标题 = tag 名 = `v<package.json version>`；tag 必须与 manifest 的 version 一致。
- 正文**必须中英双语**：中文段在前，`---` 分隔，英文段在后；两段内容一一对应，不是摘要。
- 两段都以 compare 链接收尾：`https://github.com/xbzbing/dsh-github-message/compare/<PREV>...<TAG>`，`<PREV>` 是上一个**正式版** tag，跳过中间的 stage / rc（`v0.2.0` 配 `v0.1.0`，不是配 `v0.2.0-stage.1`）。
- 不要保留 GitHub 自动生成的 `## What's Changed` 段落。
- **归档只收正式版**：`docs/releases/` 只存正式版正文，stage / rc 不写、也不留存正文文件。预发布的 Release 页面**照常写完整变更记录**，但不入库：workflow 先用 `.github/PRERELEASE_BODY.md` 的固定说明建页面，发布后用 `gh release edit --notes-file <本地文件>` 把正文写上去；重跑 workflow 不会覆盖它。
- 历史 release 页面只读不改；仓库里只随正式版新增正文文件。

## 写作规则

**主要变更**

- 一条一个用户可感知的结果，标题加粗，冒号后写「现在是什么样 / 为什么值得升级」，不是实现流水账。
- 末尾用 `（#N）` 关联 issue 或 PR；没有关联就不写。
- 顺序：面向用户的能力与修复在前，`**内部**` 类的约定 / 门禁 / 重构放最后一条。
- 不要写：版本号变更、`lib/` 重建、纯格式调整、仅测试内部改名且不改变任何保证的改动。

**安装**

- 两条都给——npm 一条（`dsh-github-message@<VERSION>`）+ 同版本 GitHub Release 附件一条。
- npm 那行**钉到本版的具体版本**，不写 `@latest`：这一页讲的是本版怎么装。
- 命令必须带 `--profile <profile>`，示例统一用 `web`。
- 预发布用 `@<dist-tag>`（如 `@stage`），并给附件一条；正文照四段结构写。

**验证**

- 写**当次** `npm run check` 的真实输出：单测数、typecheck、构建结果；workflow 门禁另跑 `npm pack` 与 `scripts/assert-pack.mjs`。
- 再写 1–3 条最有判别力的回归：修了什么、哪条测试会在去掉修复后转红。
- 没有新验证内容时，宁可只留 `npm run check` 一行，也不要编。

**篇幅**

| 版本类型 | 中文条目数 |
| --- | --- |
| patch（修 bug / 文档） | 1–4 |
| minor（新能力） | 5–10 |
| major | 按需分组，每组一个小标题 |

## 骨架

<!-- 从下一行开始复制到 release 正文 -->

## 主要变更

- **<用户可感知的标题>**：<现在是什么样、为什么值得升级>（#<issue 或 PR>）
- **修复**：<修掉的现象与影响面>（#<N>）
- **内部**：<约定 / 门禁 / 结构性改动>

## 安装

```bash
# 正式版（npm）
dsh plugin --profile web add dsh-github-message@<VERSION>

# 同一版本的 GitHub Release 附件
dsh plugin --profile web add https://github.com/xbzbing/dsh-github-message/releases/download/<TAG>/dsh-github-message-<VERSION>.tgz
```

## 验证

- `npm run check` 全绿：typecheck + <N> 单测 + host/client 构建
- <关键回归：修了什么；去掉该修复后哪条测试转红>

[完整变更记录 <PREV>...<TAG>](https://github.com/xbzbing/dsh-github-message/compare/<PREV>...<TAG>)

---

## English

- **<Title>**: <what it does now and why it is worth upgrading> (#<issue or PR>)
- **Fixes**: <the symptom and its blast radius> (#<N>)
- **Internal**: <conventions / gates / structural changes>

## Install

```bash
# Stable (npm)
dsh plugin --profile web add dsh-github-message@<VERSION>

# The same version as a GitHub Release asset
dsh plugin --profile web add https://github.com/xbzbing/dsh-github-message/releases/download/<TAG>/dsh-github-message-<VERSION>.tgz
```

## Verification

- `npm run check` green: typecheck + <N> unit tests + host/client build
- <key regression: what was fixed and which test turns red without it>

[Full changelog <PREV>...<TAG>](https://github.com/xbzbing/dsh-github-message/compare/<PREV>...<TAG>)

<!-- 复制到上一行结束 -->

## 填写素材

```bash
# 上一个正式版 tag 到 HEAD 的提交（合并提交已排除）
PREV=$(git tag --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
git log --oneline --no-merges "$PREV"..HEAD

# 当次门禁的真实数字
npm run check
```

## 发布流程

发布由 `.github/workflows/release.yml` 在「version bump 合入 main」时执行。

```bash
# 1. 版本号：package.json 与 src/constants.ts 的 PLUGIN_VERSION 必须一起改
#    （test/version.test.ts 会拦下不一致）；package-lock.json 的两处 version 也一起更新
npm version <v> --no-git-tag-version
$EDITOR src/constants.ts        # PLUGIN_VERSION = '<v>'

# 2. 正式版正文（预发布跳过这步）
$EDITOR docs/releases/v<v>.md

# 3. 提交并推送 main，workflow 自动完成剩余步骤
git add package.json package-lock.json src/constants.ts docs/releases/v<v>.md
git commit -m "chore: release v<v>"
git push origin main
```

合入 main 后 workflow 自动完成：门禁 → 打 tag → `npm publish --tag <latest|stage|rc>` → GitHub Release（附同一个 tgz；预发布带 `--prerelease`，正文先用 `.github/PRERELEASE_BODY.md` 的固定说明）。不要手工在 main 上打 tag。

预发布页面不归档正文，但**照常写完整变更记录**：

```bash
gh release edit "v<v>" --notes-file docs/local/releases/v<v>.md
```

npm 已存在同版本、远端已有 tag、已有 Release 时相应步骤自动跳过（Release 改为更新正文），失败后可以直接重跑：

```bash
gh workflow run release.yml
```

## npm 发布方式

默认走 **Trusted Publishing（OIDC）**：在 npmjs.com 的包设置里把 `release.yml` 登记为 trusted publisher，仓库不需要 `NPM_TOKEN`。

- workflow 的 `release` job 声明 `id-token: write`，`npm publish --provenance` 会自动使用 OIDC 身份。
- 如果同时配置了 `NPM_TOKEN` secret，npm 会优先用它（`.npmrc` 里由 setup-node 写入），可作为 OIDC 不可用时的回退。
- 首次发布一个全新的包时，npm 需要包已存在才能配置 trusted publisher；可先本地 `npm publish --access public --tag stage` 引导一次，之后由 workflow 接管。
