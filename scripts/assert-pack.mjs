#!/usr/bin/env node
// 校验 npm pack 出来的目录：发布产物必须自带 lib、patch、图标与文档，
// 且不能把源码、测试或本地状态一起带出去。

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? 'package');

function fail(message) {
  process.stderr.write(`assert-pack: ${message}\n`);
  process.exit(1);
}

if (!existsSync(dir)) fail(`missing package directory: ${dir}`);

const manifestPath = join(dir, 'package.json');
if (!existsSync(manifestPath)) fail('package.json is missing from the tarball');
const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'));

if (pkg.private === true) fail('package.json still declares "private": true');
if (typeof pkg.name !== 'string' || pkg.name === '') fail('package.json has no name');
if (typeof pkg.version !== 'string' || pkg.version === '') fail('package.json has no version');
if (pkg.publishConfig?.access !== 'public') fail('publishConfig.access must be "public"');

const required = [
  'lib/index.js',
  'lib/client.js',
  'lib/src/runtime.js',
  'lib/src/notices.js',
  'cordis.patch.yml',
  'assets/icon.svg',
  'README.md',
  'README.en.md',
  'LICENSE',
];
for (const file of required) {
  const full = join(dir, file);
  if (!existsSync(full)) fail(`missing ${file}`);
  if (statSync(full).size === 0) fail(`${file} is empty`);
}

// 这些目录只属于仓库，不应该出现在发布包里。
const forbidden = ['src', 'test', 'scripts', 'docs', 'node_modules'];
for (const name of forbidden) {
  if (existsSync(join(dir, name))) fail(`tarball must not contain ${name}/`);
}

// 发布包里的版本必须和运行时展示的版本一致；CI 会在 pack 之前先跑单测，
// 这里再兜一层，避免带着旧常量发出去。
const constants = readFileSync(join(dir, 'lib/src/constants.js'), 'utf8');
if (!constants.includes(pkg.version)) {
  fail(`lib/src/constants.js does not carry version ${pkg.version}`);
}

process.stdout.write(`assert-pack: ok (${pkg.name}@${pkg.version})\n`);
