// 去重状态：同一条 GitHub 事实只上报一次。核心按 (source, sourceEventId) 去重，
// 但停在 new 的信号有保留期；这里再持久化一份，重启后也不会重复提醒。

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SeenLike {
  has(id: string, now: number): boolean;
  add(id: string, at: number): void;
  readonly size: number;
}

export interface SeenLogger {
  warn?(...args: unknown[]): void;
}

export class MemorySeen implements SeenLike {
  private readonly entries = new Set<string>();

  has(id: string, _now: number): boolean {
    return this.entries.has(id);
  }

  add(id: string, at: number): void {
    void at;
    this.entries.add(id);
  }

  get size(): number {
    return this.entries.size;
  }
}

interface SeenOptions {
  file?: string;
  ttlMs: number;
  maxEntries: number;
  now: number;
  logger?: SeenLogger;
}

export class SeenStore implements SeenLike {
  private readonly entries = new Map<string, number>();
  private readonly file: string | undefined;
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private dirty = false;
  private warned = false;

  private constructor(options: SeenOptions) {
    this.file = options.file;
    this.ttlMs = options.ttlMs;
    this.maxEntries = options.maxEntries;
    if (this.file !== undefined) this.load(options.now, options.logger);
  }

  static open(options: SeenOptions): SeenStore {
    return new SeenStore(options);
  }

  private load(now: number, logger?: SeenLogger): void {
    if (this.file === undefined) return;
    let text: string;
    try {
      text = readFileSync(this.file, 'utf8');
    } catch {
      return; // 第一次运行没有状态文件，正常。
    }
    try {
      const parsed = JSON.parse(text) as { version?: unknown; entries?: unknown };
      if (parsed === null || typeof parsed !== 'object'
        || parsed.entries === null || typeof parsed.entries !== 'object' || Array.isArray(parsed.entries)) return;
      const cutoff = now - this.ttlMs;
      for (const [id, value] of Object.entries(parsed.entries as Record<string, unknown>)) {
        if (typeof value === 'number' && Number.isFinite(value) && value >= cutoff) this.entries.set(id, value);
      }
      this.trim();
    } catch (error) {
      if (!this.warned) {
        this.warned = true;
        logger?.warn?.('去重状态文件损坏，已从空状态开始', error);
      }
    }
  }

  has(id: string, now: number): boolean {
    const at = this.entries.get(id);
    if (at === undefined) return false;
    if (at < now - this.ttlMs) {
      this.entries.delete(id);
      this.dirty = true;
      return false;
    }
    return true;
  }

  add(id: string, at: number): void {
    // 删了再插，Map 的插入顺序就是最近写入顺序，超限时从最早的开始淘汰。
    this.entries.delete(id);
    this.entries.set(id, at);
    this.dirty = true;
    this.trim();
  }

  get size(): number {
    return this.entries.size;
  }

  private trim(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  /** 只在本轮有新记录时落盘；写失败只影响下次重启后的去重，不影响插件运行。 */
  save(logger?: SeenLogger): void {
    if (this.file === undefined || !this.dirty) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.tmp`;
      const body = JSON.stringify({ version: 1, entries: Object.fromEntries(this.entries) });
      writeFileSync(temporary, body, { encoding: 'utf8', mode: 0o600 });
      renameSync(temporary, this.file);
      this.dirty = false;
    } catch (error) {
      if (!this.warned) {
        this.warned = true;
        logger?.warn?.('去重状态写入失败；本轮仍会去重，重启后可能重复上报', error);
      }
    }
  }
}
