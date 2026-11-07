// @ 提醒：优先用 GitHub Notifications（精确到评论），缺 scope 或降级时用 search mentions:@me。
// 只读 Issue/PR 的正文与评论，不修改已读状态。

import { GhError, headerNumber, type GhTransport } from './gh.ts';
import type { StreamResult } from './search.ts';
import {
  cleanText,
  githubLogin,
  githubUrl,
  isoToMs,
  normalizeRepoForApi,
  repoFromApiUrl,
} from './text.ts';

export interface MentionCandidate {
  repo: string;
  number: number;
  title: string;
  commentId?: string;
  author?: string;
  excerpt: string;
  url: string;
  occurredAt: number;
  isPull: boolean;
  reason: string;
  via: 'notifications' | 'search';
}

export interface MentionResult extends StreamResult<MentionCandidate> {
  /** 304：内容没有变化。 */
  notModified: boolean;
  etag?: string;
  /** GitHub 建议的最小轮询间隔（秒）。 */
  pollIntervalMs?: number;
  /** 这一轮是否完整处理（没有需要下一轮重试的错误）。 */
  complete: boolean;
}

export interface MentionOptions {
  sinceMs: number;
  maxResults: number;
  maxPages: number;
  timeoutMs: number;
  /** 当前账号登录名；用于在正文里确认确实 @ 了我。 */
  login?: string;
  /** 上一次的 ETag；没有变化时 GitHub 返回 304。 */
  etag?: string;
}

const MENTION_REASONS = new Set(['mention', 'team_mention']);
const MAX_COMMENT_BODY = 16_000;
const API_HOST = 'api.github.com';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function baseResult(): MentionResult {
  return {
    candidates: [],
    fetched: 0,
    filtered: 0,
    skipped: 0,
    errors: [],
    authenticated: true,
    notModified: false,
    complete: true,
  };
}

function note(result: MentionResult, error: unknown): void {
  if (error instanceof GhError) {
    if (error.kind === 'unauthenticated') result.authenticated = false;
    if (result.errors.length < 10) result.errors.push(error.message);
  } else if (result.errors.length < 10) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  result.complete = false;
}

/** 只接受 api.github.com 下的 repos/... 路径，防止外部 URL 把请求带到别处。 */
export function apiPathFromUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.hostname !== API_HOST) return undefined;
  const path = url.pathname.replace(/^\/+/, '');
  if (!/^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\//.test(path)) return undefined;
  if (path.includes('..')) return undefined;
  return path;
}

/** subject.url 形如 .../issues/42 或 .../pulls/42。 */
export function subjectNumber(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /\/(?:issues|pulls)\/(\d+)(?:\/|$)/.exec(value);
  if (match?.[1] === undefined) return undefined;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function mentionPattern(login: string | undefined): RegExp {
  if (login === undefined) return /@[A-Za-z0-9-]+/;
  return new RegExp(`@${login.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
}

/** 取 @ 附近的一段正文，压成单行；找不到 @ 返回 undefined。 */
export function mentionExcerpt(body: unknown, login: string | undefined, max = 400): string | undefined {
  const text = cleanText(body, MAX_COMMENT_BODY);
  if (text === '') return undefined;
  const pattern = mentionPattern(login);
  const match = pattern.exec(text);
  if (match === null) return undefined;
  const start = Math.max(0, match.index - 100);
  const end = Math.min(text.length, match.index + match[0].length + 280);
  const excerpt = text.slice(start, end).trim();
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${excerpt}${suffix}`.slice(0, max);
}

interface MentionComment {
  id?: string;
  body: string;
  author?: string;
  url?: string;
  updatedAt: number;
}

function parseComment(raw: unknown): MentionComment | undefined {
  if (!isRecord(raw)) return undefined;
  const updatedAt = isoToMs(raw.updated_at) ?? isoToMs(raw.created_at);
  if (updatedAt === undefined) return undefined;
  const user = isRecord(raw.user) ? githubLogin(raw.user.login) : undefined;
  const id = positiveInt(raw.id);
  const comment: MentionComment = {
    body: typeof raw.body === 'string' ? raw.body : '',
    updatedAt,
  };
  if (id !== undefined) comment.id = String(id);
  if (user !== undefined) comment.author = user;
  const url = githubUrl(raw.html_url);
  if (url !== undefined) comment.url = url;
  return comment;
}

interface SubjectDetail {
  title: string;
  body: string;
  author?: string;
  url?: string;
  updatedAt: number;
  isPull: boolean;
}

function parseSubject(raw: unknown, fallbackUpdatedAt: number): SubjectDetail | undefined {
  if (!isRecord(raw)) return undefined;
  const updatedAt = isoToMs(raw.updated_at) ?? isoToMs(raw.created_at) ?? fallbackUpdatedAt;
  const user = isRecord(raw.user) ? githubLogin(raw.user.login) : undefined;
  const detail: SubjectDetail = {
    title: cleanText(raw.title, 300),
    body: typeof raw.body === 'string' ? raw.body : '',
    updatedAt,
    isPull: raw.pull_request !== undefined && raw.pull_request !== null,
  };
  if (user !== undefined) detail.author = user;
  const url = githubUrl(raw.html_url);
  if (url !== undefined) detail.url = url;
  return detail;
}

async function fetchComment(
  client: GhTransport,
  path: string,
  timeoutMs: number,
): Promise<MentionComment | undefined> {
  const response = await client.api({ endpoint: path }, timeoutMs);
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body) as unknown;
  } catch {
    throw new GhError('invalid-output', '评论不是合法 JSON');
  }
  return parseComment(parsed);
}

async function fetchSubject(
  client: GhTransport,
  repo: string,
  number: number,
  timeoutMs: number,
): Promise<SubjectDetail | undefined> {
  const response = await client.api({ endpoint: `repos/${repo}/issues/${number}` }, timeoutMs);
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body) as unknown;
  } catch {
    throw new GhError('invalid-output', 'Issue/PR 详情不是合法 JSON');
  }
  return parseSubject(parsed, Date.now());
}

export function notificationSince(sinceMs: number): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = { all: true, per_page: 50 };
  if (sinceMs > 0) params.since = new Date(sinceMs).toISOString();
  return params;
}

export async function fetchMentionCandidates(
  client: GhTransport,
  options: MentionOptions,
): Promise<MentionResult> {
  const result = baseResult();
  const perPage = Math.min(50, options.maxResults);

  for (let page = 1; page <= options.maxPages; page += 1) {
    let items: unknown[];
    try {
      const response = await client.api({
        endpoint: 'notifications',
        params: { ...notificationSince(options.sinceMs), per_page: perPage, page },
        ...(options.etag === undefined ? {} : { headers: { 'If-None-Match': options.etag } }),
      }, options.timeoutMs);
      if (response.status === 304) {
        result.notModified = true;
        result.etag = response.headers.etag ?? options.etag;
        const poll = headerNumber(response.headers, 'x-poll-interval');
        if (poll !== undefined && poll > 0) result.pollIntervalMs = poll * 1000;
        return result;
      }
      if (response.headers.etag !== undefined) result.etag = response.headers.etag;
      const poll = headerNumber(response.headers, 'x-poll-interval');
      if (poll !== undefined && poll > 0) result.pollIntervalMs = poll * 1000;
      let parsed: unknown;
      try {
        parsed = JSON.parse(response.body) as unknown;
      } catch {
        throw new GhError('invalid-output', 'notifications 返回的不是合法 JSON');
      }
      if (!Array.isArray(parsed)) throw new GhError('invalid-output', 'notifications 不是数组');
      items = parsed;
    } catch (error) {
      note(result, error);
      break;
    }

    result.fetched += items.length;
    for (const raw of items) {
      if (result.candidates.length >= options.maxResults) break;
      const candidate = await candidateFromNotification(client, raw, options, result);
      if (candidate !== undefined) result.candidates.push(candidate);
    }

    if (items.length < perPage) break;
    if (result.candidates.length >= options.maxResults) break;
  }

  return result;
}

async function candidateFromNotification(
  client: GhTransport,
  raw: unknown,
  options: MentionOptions,
  result: MentionResult,
): Promise<MentionCandidate | undefined> {
  if (!isRecord(raw)) {
    result.skipped += 1;
    return undefined;
  }
  const reason = typeof raw.reason === 'string' ? raw.reason : '';
  if (!MENTION_REASONS.has(reason)) {
    result.filtered += 1;
    return undefined;
  }
  const subject = isRecord(raw.subject) ? raw.subject : undefined;
  const type = typeof subject?.type === 'string' ? subject.type : '';
  if (type !== 'Issue' && type !== 'PullRequest') {
    result.filtered += 1;
    return undefined;
  }
  const repository = isRecord(raw.repository) ? raw.repository : undefined;
  const repo = normalizeRepoForApi(repository?.full_name);
  const number = subjectNumber(subject?.url);
  const fallbackUpdatedAt = isoToMs(raw.updated_at);
  if (repo === undefined || number === undefined || fallbackUpdatedAt === undefined) {
    result.skipped += 1;
    return undefined;
  }

  let comment: MentionComment | undefined;
  let detail: SubjectDetail | undefined;
  const commentPath = apiPathFromUrl(subject?.latest_comment_url);
  try {
    if (commentPath !== undefined) {
      comment = await fetchComment(client, commentPath, options.timeoutMs);
    } else {
      detail = await fetchSubject(client, repo, number, options.timeoutMs);
    }
  } catch (error) {
    if (error instanceof GhError && error.kind === 'not-found') {
      result.filtered += 1;
      return undefined;
    }
    note(result, error);
    return undefined;
  }

  const body = comment?.body ?? detail?.body ?? '';
  // 团队 @ 不知道具体 slug，正文里任意 @ 都算；个人 @ 必须匹配当前账号。
  const excerpt = mentionExcerpt(body, reason === 'team_mention' ? undefined : options.login);
  if (excerpt === undefined) {
    result.filtered += 1;
    return undefined;
  }

  const occurredAt = comment?.updatedAt ?? detail?.updatedAt ?? fallbackUpdatedAt;
  const url = comment?.url
    ?? detail?.url
    ?? `https://github.com/${repo}/issues/${number}`;
  const title = cleanText(subject?.title, 300) || detail?.title || `#${number}`;
  const author = comment?.author ?? detail?.author;
  return {
    repo,
    number,
    title,
    ...(comment?.id === undefined ? {} : { commentId: comment.id }),
    ...(author === undefined ? {} : { author }),
    excerpt,
    url,
    occurredAt,
    isPull: type === 'PullRequest' || detail?.isPull === true,
    reason,
    via: 'notifications',
  };
}

/** 降级：search mentions:@me。搜到的是 Issue/PR，不是具体评论，精确度低于 notifications。 */
export async function fetchMentionSearch(
  client: GhTransport,
  options: MentionOptions,
): Promise<MentionResult> {
  const result = baseResult();
  const perPage = Math.min(100, options.maxResults);
  const query = 'mentions:@me is:open';
  let budget = options.maxResults;

  for (let page = 1; page <= options.maxPages; page += 1) {
    let items: unknown[];
    let totalCount: number;
    try {
      const response = await client.api({
        endpoint: 'search/issues',
        params: { q: query, sort: 'updated', order: 'desc', per_page: perPage, page },
      }, options.timeoutMs);
      let parsed: unknown;
      try {
        parsed = JSON.parse(response.body) as unknown;
      } catch {
        throw new GhError('invalid-output', 'search/issues 返回的不是合法 JSON');
      }
      if (!isRecord(parsed) || !Array.isArray(parsed.items)) {
        throw new GhError('invalid-output', 'search/issues 缺少 items');
      }
      items = parsed.items;
      totalCount = typeof parsed.total_count === 'number' ? parsed.total_count : items.length;
    } catch (error) {
      note(result, error);
      break;
    }

    result.fetched += items.length;
    for (const raw of items) {
      if (budget <= 0) break;
      const candidate = await candidateFromSearch(client, raw, options, result);
      if (candidate !== undefined) {
        result.candidates.push(candidate);
        budget -= 1;
      }
    }
    if (items.length < perPage) break;
    if (budget <= 0) break;
    if (page * perPage >= Math.min(totalCount, 1000)) break;
  }

  return result;
}

async function candidateFromSearch(
  client: GhTransport,
  raw: unknown,
  options: MentionOptions,
  result: MentionResult,
): Promise<MentionCandidate | undefined> {
  if (!isRecord(raw)) {
    result.skipped += 1;
    return undefined;
  }
  const repo = repoFromApiUrl(raw.repository_url);
  const number = positiveInt(raw.number);
  const updatedAt = isoToMs(raw.updated_at);
  if (repo === undefined || number === undefined || updatedAt === undefined) {
    result.skipped += 1;
    return undefined;
  }
  if (options.sinceMs > 0 && updatedAt < options.sinceMs) {
    result.filtered += 1;
    return undefined;
  }

  const title = cleanText(raw.title, 300) || `#${number}`;
  const author = isRecord(raw.user) ? githubLogin(raw.user.login) : undefined;
  const isPull = raw.pull_request !== undefined && raw.pull_request !== null;
  const url = githubUrl(raw.html_url) ?? `https://github.com/${repo}/issues/${number}`;

  let excerpt = mentionExcerpt(raw.body, options.login);
  let commentId: string | undefined;
  let occurredAt = updatedAt;
  let commentAuthor: string | undefined;
  let commentUrl: string | undefined;

  if (excerpt === undefined) {
    try {
      const response = await client.api({
        endpoint: `repos/${repo}/issues/${number}/comments`,
        params: { per_page: 100 },
      }, options.timeoutMs);
      let parsed: unknown;
      try {
        parsed = JSON.parse(response.body) as unknown;
      } catch {
        throw new GhError('invalid-output', '评论列表不是合法 JSON');
      }
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const comment = parseComment(item);
          if (comment === undefined) continue;
          const found = mentionExcerpt(comment.body, options.login);
          if (found === undefined) continue;
          excerpt = found;
          commentId = comment.id;
          occurredAt = comment.updatedAt;
          commentAuthor = comment.author;
          commentUrl = comment.url;
        }
      }
    } catch (error) {
      if (error instanceof GhError && error.kind === 'not-found') {
        result.filtered += 1;
        return undefined;
      }
      note(result, error);
      return undefined;
    }
  }
  if (excerpt === undefined) {
    result.filtered += 1;
    return undefined;
  }

  const displayAuthor = commentAuthor ?? author;
  return {
    repo,
    number,
    title,
    ...(commentId === undefined ? {} : { commentId }),
    ...(displayAuthor === undefined ? {} : { author: displayAuthor }),
    excerpt,
    url: commentUrl ?? url,
    occurredAt,
    isPull,
    reason: 'mention',
    via: 'search',
  };
}
