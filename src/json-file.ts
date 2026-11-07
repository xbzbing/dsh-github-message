// 原子 JSON 文件读写：状态、统计、运行时配置共用。写失败只记日志，不阻塞插件。

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface FileLogger {
  warn?(...args: unknown[]): void;
}

export function readJsonFile(file: string | undefined, logger?: FileLogger): unknown {
  if (file === undefined) return undefined;
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return undefined; // 第一次运行没有文件，正常。
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    logger?.warn?.(`${file} 不是合法 JSON，已忽略`, error);
    return undefined;
  }
}

export function writeJsonFile(file: string | undefined, value: unknown, logger?: FileLogger): void {
  if (file === undefined) return;
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, file);
  } catch (error) {
    logger?.warn?.(`写入 ${file} 失败`, error);
  }
}
