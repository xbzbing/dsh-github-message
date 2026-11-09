---
status: accepted
date: 2026-11-09
---

# ADR-0006：Issue 流自动覆盖自有仓库与组织

Issue 流新增 `issueScope: 'repos' | 'owned'`，默认 `repos` 保持原行为；`owned` 额外用 `user:@me` 覆盖当前账号名下的仓库，并对 `orgs` 里的每个组织发一条 `org:<name>` 查询。

## 背景

原来的 Issue 流只查「维护仓库」列表，最多 10 个。用户拥有或参与的组织仓库较多时，手工维护列表既容易漏，也占满了 `maxRepos` 配额。GitHub search 原生支持 `user:USERNAME`（仓库 owner 限定）和 `org:ORGNAME`，可以用一条查询覆盖一类来源，且 `user:@me` 比逐仓库查询更省配额。

## 决策

- 增加 `issueScope`，默认 `repos`；`owned` 时来源为 `user:@me` + 每个 `orgs` 条目 + 原有 `repos` 列表。`repos` 始终保留，作为非自有仓库的补充。
- 增加 `orgs`（组织名列表）与 `maxOrgs`（默认 10，硬上限 10）；组织名按 GitHub login 规则校验，大小写不敏感去重。
- 查询语句统一由 `issueQuery` / `ownedIssueQuery` / `orgIssueQuery` 生成；日期窗口仍按 `created:>=` 天粒度加 `created_at` 精确过滤。
- 组织查询结果按仓库 owner 再校验一次，避免搜索结果串入个人仓库；`user:@me`、`org:<name>` 与显式仓库可能重叠，候选按 `repo#number` 跨来源去重。
- `owned` 模式下即使 `repos` 为空也要执行，因为 `user:@me` 本身就是来源；`repos` 模式下没有仓库仍然跳过。
- 面板增加「自动覆盖我名下的所有仓库」开关与组织列表；保存时把 `issueScope` 与 `orgs` 一并写入运行时 `config.json`。

## 代价

- `owned` 模式每轮多 1 次 `user:@me` 查询，加上每个组织 1 次；组织多时搜索请求数线性增加。默认 5 分钟一轮，建议组织数控制在个位数。
- 只覆盖当前账号名下的个人仓库；组织仓库必须显式列在 `orgs` 里，不能自动发现用户所属的全部组织。
- 仍只覆盖新开的 Issue，不包含别人在我仓库里开的 PR、评论、review 等事件；全量事件流需要 webhook 或按仓库轮询，不在本 ADR 范围。
- `orgs` 只按组织名查询，不校验当前账号是否属于该组织；填错只会得到空结果，不会越权读取。候选仍由核心回源校验仓库写权限，只读仓库的 Issue 会被判 `unrelated`。

## 相关

- [ADR-0004：三路独立轮询、时间窗与退避](0004-三路独立轮询与退避.md)
- GitHub 文档：[Searching issues and pull requests](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests)
