import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EN, interpolate, ZH } from '../src/client/locale.ts';

test('中英文字典键一致，且英文翻译没有空值', () => {
  assert.deepEqual(Object.keys(ZH).sort(), Object.keys(EN).sort());
  for (const [key, value] of Object.entries(EN)) {
    assert.ok(value.trim().length > 0, `missing English translation for ${key}`);
  }
  for (const key of Object.keys(EN)) {
    assert.equal(ZH[key], key);
  }
});

test('interpolate 替换已有占位符，保留缺失占位符', () => {
  assert.equal(interpolate('当前周期：{interval}', { interval: '5 分钟' }), '当前周期：5 分钟');
  assert.equal(interpolate('no placeholders'), 'no placeholders');
  assert.equal(interpolate('{missing}', {}), '{missing}');
});
