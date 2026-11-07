import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cleanText, githubUrl, normalizeRepoForApi, repoFromApiUrl, searchDate, splitRepo } from '../src/text.ts';

test('githubUrl 只接受干净的 github.com 页面地址', () => {
  assert.equal(githubUrl('https://github.com/o/r/pull/1'), 'https://github.com/o/r/pull/1');
  assert.equal(githubUrl('https://www.github.com/o/r/pull/1'), 'https://www.github.com/o/r/pull/1');
  assert.equal(githubUrl('http://github.com/o/r/pull/1'), undefined);
  assert.equal(githubUrl('https://u:p@github.com/o/r/pull/1'), undefined);
  assert.equal(githubUrl('https://github.com:8443/o/r/pull/1'), undefined);
  assert.equal(githubUrl('https://evil.example/o/r/pull/1'), undefined);
  assert.equal(githubUrl('javascript:alert(1)'), undefined);
});

test('cleanText 去控制字符、压空白并截断', () => {
  assert.equal(cleanText('  a\n\tb\u0000c  ', 20), 'a b c');
  assert.equal(cleanText('x'.repeat(10), 4), 'xxxx');
  assert.equal(cleanText(null, 4), '');
});

test('仓库与 API URL 校验', () => {
  assert.equal(repoFromApiUrl('https://api.github.com/repos/o/r'), 'o/r');
  assert.equal(repoFromApiUrl('https://api.github.com/repos/o/r/'), 'o/r');
  assert.equal(repoFromApiUrl('https://api.github.com/user'), undefined);
  assert.equal(normalizeRepoForApi('o/r'), 'o/r');
  assert.equal(normalizeRepoForApi('o/r/x'), undefined);
  assert.deepEqual(splitRepo('o/r'), { owner: 'o', name: 'r' });
  assert.equal(splitRepo('bad'), undefined);
  assert.equal(searchDate(0), '1970-01-01');
});
