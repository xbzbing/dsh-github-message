// GitHub 只读查询：待我评审的 PR，以及仓库列表 / 自有仓库 / 组织里的新 Issue。
// 搜索接口一次最多 100 条；PR 详情补一次 head SHA，用于按提交版本去重。

import { ORG_PATTERN, type IssueScope } from './config.ts';
import { GhError, type GhTransport } from './gh.ts';
import {
  cleanText,
  githubUrl,
  githubLogin,
  isoToMs,
  repoFromApiUrl,
  searchDate,
  SHA_PATTERN,
  splitRepo,
} from './text.ts';

export interface ReviewCandidate {
  repo: string;
  number: number;
  title: string;
  author?: string;
  headSha: string;
  baseRef: string;
  draft: boolean;
  updatedAt: number;
  url: string;
}

export interface IssueCandidate {
  repo: string;
  number: number;
  title: string;
  author?: string;
  labels: string[];
  createdAt: number;
  url: string;
}

export interface StreamResult<T> {
  candidates: T[];
  fetched: number;
  filtered: number;
  skipped: number;
  errors: string[];
  /** 失败原因里出现 401/凭据失效。 */
  authenticated: boolean;
  /** 命中限流时 GitHub 给出的重置时间。 */
  rateLimitResetAt?: number;
}

export interface ReviewOptions {
  sinceMs: number;
  maxResults: number;
  maxPages: number;
  includeDrafts: boolean;
  timeoutMs: number;
  /** 用哪条搜索语句：默认「待我评审」，自提 PR 那条传 SELF_QUERY。 */
  query?: string;
}

export interface IssueOptions {
  repos: string[];
  orgs: string[];
  scope: IssueScope;
  sinceMs: number;
  maxResults: number;
  maxPages: number;
  timeoutMs: number;
}

export interface PullDetail {
  headSha: string;
  baseRef: string;
  state: string;
  merged: boolean;
  draft: boolean;
  updatedAt: number;
  title: string;
  author?: string;
  url?: string;
}

export const REVIEW_QUERY = 'is:pr is:open review-requested:@me';
// 自己提的 PR（ADR-0087）：不判断要不要打扰主人，那是核心的开关；这里只负责把事实报上去。
export const SELF_QUERY = 'is:pr is:open author:@me';

function emptyResult<T>(): StreamResult<T> {
  return { candidates: [], fetched: 0, filtered: 0, skipped: 0, errors: [], authenticated: true };
}

function note(result: { errors: string[]; authenticated: boolean; rateLimitResetAt?: number }, error: unknown): void {
  if (error instanceof GhError) {
    if (error.kind === 'unauthenticated') result.authenticated = false;
    if (error.kind === 'rate-limited' && error.retryAt !== undefined) result.rateLimitResetAt = error.retryAt;
    if (result.errors.length < 10) result.errors.push(error.message);
    return;
  }
  if (result.errors.length < 10) result.errors.push(error instanceof Error ? error.message : String(error));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

interface SearchItem {
  repo: string;
  number: number;
  title: string;
  url?: string;
  author?: string;
  updatedAt: number;
  createdAt: number;
  updatedRaw: string;
  draft: boolean;
  isPull: boolean;
  labels: string[];
}

function parseSearchItem(raw: unknown): SearchItem | undefined {
  if (!isRecord(raw)) return undefined;
  const repo = repoFromApiUrl(raw.repository_url);
  const number = positiveInt(raw.number);
  if (repo === undefined || number === undefined) return undefined;
  const updatedRaw = typeof raw.updated_at === 'string' ? raw.updated_at : '';
  const updatedAt = isoToMs(raw.updated_at);
  const createdAt = isoToMs(raw.created_at);
  if (updatedAt === undefined && createdAt === undefined) return undefined;
  const user = isRecord(raw.user) ? githubLogin(raw.user.login) : undefined;
  const labels: string[] = [];
  if (Array.isArray(raw.labels)) {
    for (const label of raw.labels.slice(0, 20)) {
      const name = isRecord(label) ? cleanText(label.name, 50) : '';
      if (name !== '') labels.push(name);
    }
  }
  return {
    repo,
    number,
    title: cleanText(raw.title, 300) || `#${number}`,
    ...(githubUrl(raw.html_url) === undefined ? {} : { url: githubUrl(raw.html_url) }),
    ...(user === undefined ? {} : { author: user }),
    updatedAt: updatedAt ?? createdAt ?? 0,
    createdAt: createdAt ?? updatedAt ?? 0,
    updatedRaw,
    draft: raw.draft === true,
    isPull: raw.pull_request !== undefined && raw.pull_request !== null,
    labels,
  };
}

/** 读一页 search/issues；返回原始条目与总数。 */
async function searchPage(
  client: GhTransport,
  query: string,
  page: number,
  perPage: number,
  sort: 'updated' | 'created',
  timeoutMs: number,
): Promise<{ items: unknown[]; totalCount: number }> {
  const response = await client.api({
    endpoint: 'search/issues',
    params: { q: query, sort, order: 'desc', per_page: perPage, page },
  }, timeoutMs);
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body) as unknown;
  } catch {
    throw new GhError('invalid-output', 'search/issues 返回的不是合法 JSON');
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.items)) {
    throw new GhError('invalid-output', 'search/issues 缺少 items');
  }
  return {
    items: parsed.items,
    totalCount: typeof parsed.total_count === 'number' && parsed.total_count >= 0 ? parsed.total_count : parsed.items.length,
  };
}

export function parsePullDetail(raw: unknown): PullDetail | undefined {
  if (!isRecord(raw)) return undefined;
  const head = isRecord(raw.head) ? raw.head : undefined;
  const base = isRecord(raw.base) ? raw.base : undefined;
  const sha = typeof head?.sha === 'string' && SHA_PATTERN.test(head.sha) ? head.sha : undefined;
  if (sha === undefined) return undefined;
  const updatedAt = isoToMs(raw.updated_at);
  if (updatedAt === undefined) return undefined;
  const user = isRecord(raw.user) ? githubLogin(raw.user.login) : undefined;
  const detail: PullDetail = {
    headSha: sha,
    baseRef: cleanText(base?.ref, 200),
    state: cleanText(raw.state, 20),
    merged: raw.merged === true,
    draft: raw.draft === true,
    updatedAt,
    title: cleanText(raw.title, 300),
  };
  if (user !== undefined) detail.author = user;
  const url = githubUrl(raw.html_url);
  if (url !== undefined) detail.url = url;
  return detail;
}

/** 按搜索结果的 updated_at 缓存 PR 详情；同一轮/下一轮未更新时不再请求。 */
export class PullCache {
  private readonly entries = new Map<string, { updatedRaw: string; detail: PullDetail }>();
  private readonly maxEntries: number;

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
  }

  get size(): number {
    return this.entries.size;
  }

  key(repo: string, number: number): string {
    return `${repo.toLowerCase()}#${number}`;
  }

  get(repo: string, number: number, updatedRaw: string): PullDetail | undefined {
    const key = this.key(repo, number);
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (updatedRaw !== '' && entry.updatedRaw !== '' && entry.updatedRaw !== updatedRaw) return undefined;
    return entry.detail;
  }

  set(repo: string, number: number, updatedRaw: string, detail: PullDetail): void {
    const key = this.key(repo, number);
    this.entries.delete(key);
    this.entries.set(key, { updatedRaw, detail });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
}

export async function fetchReviewCandidates(
  client: GhTransport,
  options: ReviewOptions,
  cache: PullCache = new PullCache(),
): Promise<StreamResult<ReviewCandidate>> {
  const result = emptyResult<ReviewCandidate>();
  const perPage = Math.min(100, options.maxResults);

  for (let page = 1; page <= options.maxPages; page += 1) {
    let items: unknown[];
    let totalCount: number;
    try {
      const response = await searchPage(client, options.query ?? REVIEW_QUERY, page, perPage, 'updated', options.timeoutMs);
      items = response.items;
      totalCount = response.totalCount;
    } catch (error) {
      note(result, error);
      break;
    }
    result.fetched += items.length;

    for (const raw of items) {
      if (result.candidates.length >= options.maxResults) break;
      const item = parseSearchItem(raw);
      if (item === undefined) {
        result.skipped += 1;
        continue;
      }
      let detail = cache.get(item.repo, item.number, item.updatedRaw);
      if (detail === undefined) {
        try {
          const response = await client.api({ endpoint: `repos/${item.repo}/pulls/${item.number}` }, options.timeoutMs);
          let parsed: unknown;
          try {
            parsed = JSON.parse(response.body) as unknown;
          } catch {
            throw new GhError('invalid-output', `PR ${item.repo}#${item.number} 详情不是合法 JSON`);
          }
          detail = parsePullDetail(parsed);
          if (detail === undefined) {
            result.skipped += 1;
            continue;
          }
          cache.set(item.repo, item.number, item.updatedRaw, detail);
        } catch (error) {
          if (error instanceof GhError && error.kind === 'not-found') {
            result.filtered += 1;
            continue;
          }
          note(result, error);
          continue;
        }
      }

      if (detail.state !== 'open' || detail.merged) {
        result.filtered += 1;
        continue;
      }
      if (options.sinceMs > 0 && detail.updatedAt < options.sinceMs) {
        result.filtered += 1;
        continue;
      }
      if (detail.draft && !options.includeDrafts) {
        result.filtered += 1;
        continue;
      }
      const url = detail.url ?? item.url ?? `https://github.com/${item.repo}/pull/${item.number}`;
      const author = detail.author ?? item.author;
      result.candidates.push({
        repo: item.repo,
        number: item.number,
        title: detail.title || item.title,
        ...(author === undefined ? {} : { author }),
        headSha: detail.headSha,
        baseRef: detail.baseRef,
        draft: detail.draft,
        updatedAt: detail.updatedAt,
        url,
      });
    }

    if (items.length < perPage) break;
    if (result.candidates.length >= options.maxResults) break;
    if (page * perPage >= Math.min(totalCount, 1000)) break;
  }

  return result;
}

const DAY_MS = 24 * 60 * 60_000;

function issueQueryWith(qualifier: string, sinceMs: number): string {
  const parts = [qualifier, 'is:issue', 'is:open'];
  if (sinceMs > 0) {
    // 日期限定精确到天；多取一天，再用 created_at 精确过滤，避免时区导致漏报。
    parts.push(`created:>=${searchDate(sinceMs - DAY_MS)}`);
  }
  return parts.join(' ');
}

export function issueQuery(repo: string, sinceMs: number): string {
  return issueQueryWith(`repo:${repo}`, sinceMs);
}

/** 当前账号名下的仓库；`user:@me` 是 GitHub search 的仓库 owner 限定。 */
export function ownedIssueQuery(sinceMs: number): string {
  return issueQueryWith('user:@me', sinceMs);
}

/** 指定组织名下的仓库。 */
export function orgIssueQuery(org: string, sinceMs: number): string {
  return issueQueryWith(`org:${org}`, sinceMs);
}

interface IssueSource {
  kind: 'repo' | 'owned' | 'org';
  value: string;
  query: string;
}

/** `owned` 模式先查账号名下仓库与组织，再叠加显式仓库；`repos` 模式只看显式仓库。 */
function issueSources(options: IssueOptions): { sources: IssueSource[]; skipped: number } {
  const sources: IssueSource[] = [];
  let skipped = 0;
  if (options.scope === 'owned') {
    sources.push({ kind: 'owned', value: '@me', query: ownedIssueQuery(options.sinceMs) });
    for (const org of options.orgs) {
      // 配置层已校验；这里再挡一次，避免直接调用时把任意字符串拼进搜索语句。
      if (!ORG_PATTERN.test(org)) {
        skipped += 1;
        continue;
      }
      sources.push({ kind: 'org', value: org, query: orgIssueQuery(org, options.sinceMs) });
    }
  }
  for (const repo of options.repos) {
    sources.push({ kind: 'repo', value: repo, query: issueQuery(repo, options.sinceMs) });
  }
  return { sources, skipped };
}

function matchesIssueSource(source: IssueSource, repo: string): boolean {
  if (source.kind === 'owned') return true;
  const lower = repo.toLowerCase();
  if (source.kind === 'repo') return lower === source.value.toLowerCase();
  // 组织查询按 owner 再校验一次，避免把搜索结果里串进来的个人仓库当组织仓库。
  const owner = splitRepo(repo)?.owner;
  return owner !== undefined && owner.toLowerCase() === source.value.toLowerCase();
}

export async function fetchIssueCandidates(
  client: GhTransport,
  options: IssueOptions,
): Promise<StreamResult<IssueCandidate>> {
  const result = emptyResult<IssueCandidate>();
  const { sources, skipped } = issueSources(options);
  result.skipped += skipped;
  if (sources.length === 0) return result;
  const perPage = Math.min(100, options.maxResults);
  const collected: IssueCandidate[] = [];
  const collectedKeys = new Set<string>();

  for (const source of sources) {
    if (source.kind === 'repo' && splitRepo(source.value) === undefined) {
      result.skipped += 1;
      continue;
    }
    let sourceCount = 0;
    for (let page = 1; page <= options.maxPages; page += 1) {
      let items: unknown[];
      let totalCount: number;
      try {
        const response = await searchPage(client, source.query, page, perPage, 'created', options.timeoutMs);
        items = response.items;
        totalCount = response.totalCount;
      } catch (error) {
        note(result, error);
        break;
      }
      result.fetched += items.length;

      for (const raw of items) {
        if (sourceCount >= options.maxResults) break;
        const item = parseSearchItem(raw);
        if (item === undefined) {
          result.skipped += 1;
          continue;
        }
        if (item.isPull || !matchesIssueSource(source, item.repo)) {
          result.filtered += 1;
          continue;
        }
        if (options.sinceMs > 0 && item.createdAt < options.sinceMs) {
          result.filtered += 1;
          continue;
        }
        // user:@me、org:<name> 与显式仓库可能覆盖同一 Issue，跨来源按 repo#number 去重。
        const key = `${item.repo.toLowerCase()}#${item.number}`;
        if (collectedKeys.has(key)) {
          result.filtered += 1;
          continue;
        }
        collectedKeys.add(key);
        collected.push({
          repo: item.repo,
          number: item.number,
          title: item.title,
          ...(item.author === undefined ? {} : { author: item.author }),
          labels: item.labels,
          createdAt: item.createdAt,
          url: item.url ?? `https://github.com/${item.repo}/issues/${item.number}`,
        });
        sourceCount += 1;
      }

      if (items.length < perPage) break;
      if (sourceCount >= options.maxResults) break;
      if (page * perPage >= Math.min(totalCount, 1000)) break;
    }
  }

  // 每个来源都先取自己的候选，再按创建时间归并，避免第一个来源占满全局预算。
  result.candidates = collected
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, options.maxResults);
  return result;
}
