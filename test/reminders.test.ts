import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { coreStatePath, readCoreSignals } from '../src/reminders.ts';

function tempHome(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-github-reminders-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('DSH_HOME 缺失时返回 db-missing', (t) => {
  const home = tempHome(t);
  const stats = readCoreSignals('github-message', { DSH_HOME: home }, home);
  assert.equal(stats.available, false);
  assert.equal(stats.code, 'db-missing');
  assert.equal(coreStatePath({ DSH_HOME: home }, home), join(home, 'dsh-my-superagent', 'state.sqlite'));
});

test('按 kind/state 统计只读数据库', (t) => {
  const home = tempHome(t);
  const dir = join(home, 'dsh-my-superagent');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'state.sqlite');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE signals (source TEXT NOT NULL, kind TEXT NOT NULL, state TEXT NOT NULL)');
  const insert = db.prepare('INSERT INTO signals (source, kind, state) VALUES (?, ?, ?)');
  insert.run('github-message', 'code-review.requested', 'ignored');
  insert.run('github-message', 'code-review.requested', 'admitted');
  insert.run('github-message', 'github.issue.opened', 'ignored');
  insert.run('icode-message', 'code-review.requested', 'admitted');
  db.close();

  const stats = readCoreSignals('github-message', { DSH_HOME: home }, home);
  assert.equal(stats.available, true);
  assert.equal(stats.total, 3);
  assert.equal(stats.byState.ignored, 2);
  assert.equal(stats.byState.admitted, 1);
  assert.equal(stats.byKind['code-review.requested']?.ignored, 1);
  assert.equal(stats.byKind['github.issue.opened']?.ignored, 1);
  assert.equal(stats.byKind['github.mention'], undefined);
});

test('数据库损坏时降级为 read-failed', (t) => {
  const home = tempHome(t);
  const dir = join(home, 'dsh-my-superagent');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.sqlite'), 'not sqlite');
  const stats = readCoreSignals('github-message', { DSH_HOME: home }, home);
  assert.equal(stats.available, false);
  assert.equal(stats.code, 'read-failed');
});
