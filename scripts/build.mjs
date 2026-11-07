#!/usr/bin/env node
// 构建 lib/：host 由 tsc 编译；client 由 esbuild 打成单个 lib/client.js。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'lib');
const PACKAGE_NAME = 'dsh-github-message';
const PLATFORM_MODULES = ['react', 'react-dom', 'react-dom/client', '@deepseek-ai/*'];

function buildHost() {
  const tsc = join(root, 'node_modules/typescript/bin/tsc');
  if (!existsSync(tsc)) throw new Error('找不到 typescript，请先执行 npm install');
  const result = spawnSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.build.json'), '--pretty', 'false'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error(`tsc 编译失败（退出码 ${String(result.status)}）`);
}

async function buildClient() {
  await esbuild.build({
    entryPoints: [join(root, 'src/client/index.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    external: PLATFORM_MODULES,
    outfile: join(outDir, 'client.js'),
    logLevel: 'warning',
    logOverride: { 'commonjs-variable-in-esm': 'silent', 'require-resolve-not-external': 'silent' },
    banner: {
      js: `window.__ModuleLoader__.load({ id: "${PACKAGE_NAME}", factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`,
    },
    footer: { js: 'return module.exports;\n} });' },
  });
}

async function main() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  buildHost();
  await buildClient();
  for (const entry of ['index.js', 'client.js']) {
    if (!existsSync(join(outDir, entry))) throw new Error(`产物缺少入口：${entry}`);
  }
  process.stdout.write('构建完成：lib/index.js（host）、lib/client.js（web 面板）\n');
}

main().catch((error) => {
  process.stderr.write(`构建失败：${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
