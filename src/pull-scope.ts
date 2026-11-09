// prScope=owned 的检索语句规划：当前账号、组织与显式仓库各一条。
// 这里只拼语句、做校验；真正的取数仍在 search.ts 的 fetchReviewCandidates。

import { ORG_PATTERN } from './config.ts';
import { splitRepo } from './text.ts';

// 自有仓库里别人开的 PR（ADR-0007）：按仓库 owner 限定，不要求先被请求评审。
export const OWNED_PULL_QUERY = 'is:pr is:open user:@me';

export function orgPullQuery(org: string): string {
  return `is:pr is:open org:${org}`;
}

export function repoPullQuery(repo: string): string {
  return `is:pr is:open repo:${repo}`;
}

/** `prScope=owned` 的来源：当前账号、组织、显式仓库；非法项计入 skipped。 */
export function ownedPullSources(options: { repos: string[]; orgs: string[] }): { queries: string[]; skipped: number } {
  const queries: string[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  const push = (query: string): void => {
    const key = query.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    queries.push(query);
  };
  push(OWNED_PULL_QUERY);
  for (const org of options.orgs) {
    // 配置层已校验；这里再挡一次，避免直接调用时把任意字符串拼进搜索语句。
    if (!ORG_PATTERN.test(org)) {
      skipped += 1;
      continue;
    }
    push(orgPullQuery(org));
  }
  for (const repo of options.repos) {
    if (splitRepo(repo) === undefined) {
      skipped += 1;
      continue;
    }
    push(repoPullQuery(repo));
  }
  return { queries, skipped };
}
