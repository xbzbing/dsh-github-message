import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { PLUGIN_VERSION } from '../src/constants.ts';

test('PLUGIN_VERSION 与 package.json 的版本一致', () => {
  const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  const pkg = JSON.parse(raw) as { version?: unknown };
  assert.equal(typeof pkg.version, 'string');
  // 面板与轮询日志都读这个常量；发版时两处必须一起改，否则线上显示旧版本。
  assert.equal(PLUGIN_VERSION, pkg.version);
});
