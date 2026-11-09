import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadRuntimeConfig, saveRuntimeConfig } from '../src/runtime-config.ts';

const temp = (t: { after: (fn: () => void) => void }): string => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-github-runtime-config-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('运行时配置往返，过滤非法仓库与周期', (t) => {
  const file = join(temp(t), 'config.json');
  saveRuntimeConfig(file, {
    intervalMs: 600_000,
    repos: ['xbzbing/dsh-git-panel', 'xbzbing/dsh-my-superagent'],
    issueScope: 'owned',
    orgs: ['my-org'],
  });
  const loaded = loadRuntimeConfig(file);
  assert.equal(loaded.intervalMs, 600_000);
  assert.deepEqual(loaded.repos, ['xbzbing/dsh-git-panel', 'xbzbing/dsh-my-superagent']);
  assert.equal(loaded.issueScope, 'owned');
  assert.deepEqual(loaded.orgs, ['my-org']);
});

test('损坏或非法的运行时配置降级为空', (t) => {
  const dir = temp(t);
  const missing = join(dir, 'missing.json');
  assert.deepEqual(loadRuntimeConfig(missing), {});

  const broken = join(dir, 'broken.json');
  writeFileSync(broken, 'not json');
  assert.deepEqual(loadRuntimeConfig(broken), {});

  const invalid = join(dir, 'invalid.json');
  writeFileSync(invalid, JSON.stringify({
    intervalMs: -1,
    repos: ['bad', 'o/r', 42],
    issueScope: 'all',
    orgs: ['bad_org', 'my-org', 42],
  }));
  assert.deepEqual(loadRuntimeConfig(invalid), { repos: ['o/r'], orgs: ['my-org'] });
});
