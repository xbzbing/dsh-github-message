import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { MemorySeen, SeenStore } from '../src/state.ts';

const DAY = 24 * 60 * 60_000;

test('MemorySeen 只记存在性', () => {
  const seen = new MemorySeen();
  assert.equal(seen.has('a', 0), false);
  seen.add('a', 0);
  assert.equal(seen.has('a', Number.MAX_SAFE_INTEGER), true);
  assert.equal(seen.size, 1);
});

test('SeenStore 持久化并跨实例恢复', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-github-seen-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'seen.json');

  const first = SeenStore.open({ file, ttlMs: DAY, maxEntries: 10, now: 1_000 });
  first.add('review:o/r#1:abc', 1_000);
  first.save();
  assert.equal(first.has('review:o/r#1:abc', 2_000), true);

  const second = SeenStore.open({ file, ttlMs: DAY, maxEntries: 10, now: 2_000 });
  assert.equal(second.has('review:o/r#1:abc', 2_000), true);
  assert.equal(second.size, 1);
});

test('SeenStore 按 TTL 过期', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-github-seen-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'seen.json');
  const store = SeenStore.open({ file, ttlMs: DAY, maxEntries: 10, now: 0 });
  store.add('old', 0);
  assert.equal(store.has('old', DAY + 1), false);
  assert.equal(store.size, 0);
});

test('SeenStore 超过上限时淘汰最早写入的键', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-github-seen-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = SeenStore.open({ file: join(dir, 'seen.json'), ttlMs: DAY, maxEntries: 2, now: 0 });
  store.add('a', 0);
  store.add('b', 0);
  store.add('c', 0);
  assert.equal(store.size, 2);
  assert.equal(store.has('a', 0), false);
  assert.equal(store.has('b', 0), true);
  assert.equal(store.has('c', 0), true);
});

test('损坏的状态文件降级为空状态并只警告一次', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-github-seen-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'seen.json');
  writeFileSync(file, 'not json');
  const warnings: unknown[] = [];
  const store = SeenStore.open({ file, ttlMs: DAY, maxEntries: 10, now: 0, logger: { warn: (...args) => warnings.push(args) } });
  assert.equal(store.size, 0);
  assert.equal(warnings.length, 1);
});
