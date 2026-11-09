import assert from 'node:assert/strict';
import { test } from 'node:test';

import { issueDraft, mentionDraft, repoPullDraft, reviewDraft, selfPullDraft } from '../src/signals.ts';

const SHA = 'a'.repeat(40);

test('review 信号：subject、事件键、actor 与链接', () => {
  const draft = reviewDraft({
    repo: 'Xbzbing/Dsh-Git-Panel',
    number: 12,
    title: '  修复\n换行  ',
    author: 'alice',
    headSha: SHA,
    baseRef: 'main',
    draft: false,
    updatedAt: Date.parse('2026-11-07T08:00:00Z'),
    url: 'https://github.com/Xbzbing/Dsh-Git-Panel/pull/12',
  });
  assert.equal(draft.sourceEventId, `review:xbzbing/dsh-git-panel#12:${SHA}`);
  assert.equal(draft.subject, 'github:Xbzbing/Dsh-Git-Panel/pull/12');
  assert.equal(draft.summary, 'Xbzbing/Dsh-Git-Panel #12 修复 换行');
  assert.equal(draft.actor?.id, 'alice');
  assert.deepEqual(draft.links, [{ title: '查看 PR', url: 'https://github.com/Xbzbing/Dsh-Git-Panel/pull/12' }]);
  assert.equal(draft.payload?.via, 'search');
});

test('自有仓库 PR 用独立 kind，与自提 PR 的事件键前缀也不同', () => {
  const candidate = {
    repo: 'alice/project',
    number: 8,
    title: '别人在我仓库里提的 PR',
    author: 'bob',
    headSha: SHA,
    baseRef: 'main',
    draft: false,
    updatedAt: Date.parse('2026-11-08T08:00:00Z'),
    url: 'https://github.com/alice/project/pull/8',
  };
  const repo = repoPullDraft(candidate);
  const self = selfPullDraft(candidate);
  assert.equal(repo.kind, 'github.pr.repo');
  assert.equal(self.kind, 'github.pr.opened');
  assert.equal(repo.sourceEventId, `repo:alice/project#8:${SHA}`);
  assert.equal(self.sourceEventId, `self:alice/project#8:${SHA}`);
  assert.equal(repo.payload?.via, 'repo-owned');
  assert.equal(self.payload?.via, 'self');
  assert.equal(repo.subject, 'github:alice/project/pull/8');
});

test('issue 信号：标签清洗与非法链接不输出', () => {
  const draft = issueDraft({
    repo: 'o/r',
    number: 7,
    title: '标题',
    author: 'bob',
    labels: ['bug', '   ', 'x'.repeat(120)],
    createdAt: 1_700_000_000_000,
    url: 'javascript:alert(1)',
  });
  assert.equal(draft.kind, 'github.issue.opened');
  assert.equal(draft.sourceEventId, 'issue:o/r#7');
  assert.equal(draft.summary, '新 Issue：o/r #7 标题');
  assert.deepEqual(draft.payload?.labels, ['bug', 'x'.repeat(50)]);
  assert.equal(draft.payload?.url, null);
  assert.equal(draft.links, undefined);
});

test('mention 信号：评论 id 与无 id 时的 body 兜底', () => {
  const withId = mentionDraft({
    repo: 'o/r',
    number: 5,
    title: '讨论',
    commentId: '99',
    author: 'bob',
    excerpt: '请 @alice 看一下',
    url: 'https://github.com/o/r/issues/5#issuecomment-99',
    occurredAt: Date.parse('2026-11-07T09:00:00Z'),
    isPull: true,
    reason: 'mention',
    via: 'notifications',
  });
  assert.equal(withId.sourceEventId, 'mention:o/r#5:99');
  assert.equal(withId.subject, 'github:o/r/issues/5');
  assert.equal(withId.summary, 'o/r #5 有人 @ 你');
  assert.equal(withId.payload?.isPull, true);
  assert.equal(withId.payload?.excerpt, '请 @alice 看一下');

  const withoutId = mentionDraft({
    repo: 'o/r',
    number: 5,
    title: '讨论',
    excerpt: '正文 @alice',
    url: 'https://github.com/o/r/issues/5',
    occurredAt: Date.parse('2026-11-07T09:00:00Z'),
    isPull: false,
    reason: 'team_mention',
    via: 'notifications',
  });
  assert.equal(withoutId.sourceEventId, 'mention:o/r#5:body');
  assert.equal(withoutId.payload?.commentId, null);
});
