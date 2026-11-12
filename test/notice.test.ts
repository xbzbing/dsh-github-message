import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createNotice, dismissInMs, NOTICE_DISMISS_MS } from '../src/client/notice.ts';

test('成功提示 5 秒后自动消失', () => {
  const now = 1_700_000_000_000;
  const notice = createNotice(1, '统计已重置', 'info', now);
  assert.equal(NOTICE_DISMISS_MS, 5_000);
  assert.equal(notice.expiresAt, now + 5_000);
  assert.equal(dismissInMs(notice, now), 5_000);
  assert.equal(dismissInMs(notice, now + 4_999), 1);
  assert.equal(dismissInMs(notice, now + 5_000), 0);
  assert.equal(dismissInMs(notice, now + 60_000), 0);
});

test('失败提示不自动消失，只能手动关闭', () => {
  const now = 1_700_000_000_000;
  const notice = createNotice(2, '操作失败：boom', 'error', now);
  assert.equal(notice.expiresAt, undefined);
  assert.equal(dismissInMs(notice, now + 60_000), undefined);
});
