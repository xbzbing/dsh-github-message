// 把三类 GitHub 事实翻译成 my-superagent/v1 的 SignalDraft。
// 这里只做字段收敛与截断，不做“要不要打扰主人”的判断。

import { KIND_ISSUE, KIND_MENTION, KIND_REVIEW, KIND_SELF } from './constants.ts';
import type { MentionCandidate } from './notifications.ts';
import type { IssueCandidate, ReviewCandidate } from './search.ts';
import { cleanText, githubUrl, repoKey } from './text.ts';

export interface SignalLink {
  title: string;
  url: string;
}

export interface SignalDraft {
  sourceEventId: string;
  kind: string;
  occurredAt: number;
  subject: string;
  summary: string;
  actor?: { id: string };
  links?: SignalLink[];
  payload?: Record<string, unknown>;
}

const MAX_SUBJECT = 512;
const MAX_SUMMARY = 2000;
const MAX_EVENT_ID = 256;
const MAX_TITLE = 300;
const MAX_EXCERPT = 400;

function stamp(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function link(title: string, url: string): SignalLink[] | undefined {
  const valid = githubUrl(url);
  return valid === undefined ? undefined : [{ title, url: valid }];
}

function actorOf(id: string | undefined): { id: string } | undefined {
  return id === undefined || id === '' ? undefined : { id: id.slice(0, 128) };
}

export function reviewDraft(review: ReviewCandidate): SignalDraft {
  const repo = review.repo.slice(0, 200);
  const title = cleanText(review.title, MAX_TITLE);
  const draft: SignalDraft = {
    sourceEventId: `review:${repoKey(repo)}#${review.number}:${review.headSha}`.slice(0, MAX_EVENT_ID),
    kind: KIND_REVIEW,
    occurredAt: stamp(review.updatedAt),
    subject: `github:${repo}/pull/${review.number}`.slice(0, MAX_SUBJECT),
    summary: `${repo} #${review.number} ${title}`.slice(0, MAX_SUMMARY),
    payload: {
      repo,
      number: review.number,
      title,
      author: review.author ?? null,
      headSha: review.headSha,
      baseRef: cleanText(review.baseRef, 200),
      draft: review.draft,
      updatedAt: new Date(stamp(review.updatedAt)).toISOString(),
      url: githubUrl(review.url) ?? null,
      via: 'search',
    },
  };
  const actor = actorOf(review.author);
  if (actor !== undefined) draft.actor = actor;
  const links = link('查看 PR', review.url);
  if (links !== undefined) draft.links = links;
  return draft;
}

// 自己提的 PR（ADR-0087）：字段收敛与 reviewDraft 一样，只换 kind 与 sourceEventId 前缀，
// 免得两类信号在核心侧被当成同一条去重掉。
export function selfPullDraft(review: ReviewCandidate): SignalDraft {
  const draft = reviewDraft(review);
  return {
    ...draft,
    sourceEventId: `self:${draft.sourceEventId.replace(/^review:/, '')}`.slice(0, MAX_EVENT_ID),
    kind: KIND_SELF,
    payload: { ...draft.payload, via: 'self' },
  };
}

export function issueDraft(issue: IssueCandidate): SignalDraft {
  const repo = issue.repo.slice(0, 200);
  const title = cleanText(issue.title, MAX_TITLE);
  const labels = issue.labels
    .map((label) => cleanText(label, 50))
    .filter((label) => label !== '')
    .slice(0, 20);
  const draft: SignalDraft = {
    sourceEventId: `issue:${repoKey(repo)}#${issue.number}`.slice(0, MAX_EVENT_ID),
    kind: KIND_ISSUE,
    occurredAt: stamp(issue.createdAt),
    subject: `github:${repo}/issues/${issue.number}`.slice(0, MAX_SUBJECT),
    summary: `新 Issue：${repo} #${issue.number} ${title}`.slice(0, MAX_SUMMARY),
    payload: {
      repo,
      number: issue.number,
      title,
      author: issue.author ?? null,
      labels,
      state: 'open',
      createdAt: new Date(stamp(issue.createdAt)).toISOString(),
      url: githubUrl(issue.url) ?? null,
      via: 'search',
    },
  };
  const actor = actorOf(issue.author);
  if (actor !== undefined) draft.actor = actor;
  const links = link('查看 Issue', issue.url);
  if (links !== undefined) draft.links = links;
  return draft;
}

export function mentionDraft(mention: MentionCandidate): SignalDraft {
  const repo = mention.repo.slice(0, 200);
  const title = cleanText(mention.title, MAX_TITLE);
  const excerpt = cleanText(mention.excerpt, MAX_EXCERPT);
  // 没有评论 id 时用稳定的 body 标记，避免正文每次编辑都生成新事件。
  const suffix = mention.commentId ?? 'body';
  const draft: SignalDraft = {
    sourceEventId: `mention:${repoKey(repo)}#${mention.number}:${suffix}`.slice(0, MAX_EVENT_ID),
    kind: KIND_MENTION,
    occurredAt: stamp(mention.occurredAt),
    subject: `github:${repo}/issues/${mention.number}`.slice(0, MAX_SUBJECT),
    summary: `${repo} #${mention.number} 有人 @ 你`.slice(0, MAX_SUMMARY),
    payload: {
      repo,
      number: mention.number,
      title,
      commentId: mention.commentId ?? null,
      author: mention.author ?? null,
      excerpt,
      url: githubUrl(mention.url) ?? null,
      via: mention.via,
      isPull: mention.isPull,
      reason: mention.reason,
    },
  };
  const actor = actorOf(mention.author);
  if (actor !== undefined) draft.actor = actor;
  const links = link('查看讨论', mention.url);
  if (links !== undefined) draft.links = links;
  return draft;
}
