// client 半入口：注册文案、设置页配置卡与插件页包配置卡。

import {
  BUNDLE_CONFIG_SLOT,
  PACKAGE_NAME,
  PANEL_ID,
  SLOT_NAME,
} from '../constants.ts';
import { bindLocale } from './locale.ts';
import { GithubMessagePanel } from './panel.ts';
import { createRpcCall, type Connection } from './rpc.ts';

export const name = PACKAGE_NAME;
export const inject = ['slots', 'connection', 'locale'] as const;

interface ClientContext {
  effect?(execute: () => (() => void) | void, label?: string): unknown;
  slots?: {
    inject?(name: string, factory: () => unknown): (() => void) | undefined;
    register?(options: Record<string, unknown>, component: unknown): unknown;
  };
  connection?: Connection;
  locale?: {
    register?(ns: string, dictionaries: Record<string, Record<string, string>>): (() => void) | void;
    bind?(ns: string): ((text: string, values?: Record<string, unknown>) => string) | undefined;
  };
}

export function apply(ctx: ClientContext): void {
  const t = bindLocale(ctx);
  const rpcCall = createRpcCall(ctx.connection);
  const slots = ctx.slots;
  if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') return;

  const effect = typeof ctx.effect === 'function'
    ? ctx.effect.bind(ctx)
    : (execute: () => (() => void) | void): unknown => execute();

  const mount = (slot: string, options: Record<string, unknown>): void => {
    effect(() => {
      const dispose = slots.inject?.(slot, () => slots.register?.({
        name: slot,
        locale: PACKAGE_NAME,
        ...options,
        inject: () => ({ t, rpcCall }),
      }, GithubMessagePanel));
      return () => {
        if (typeof dispose === 'function') dispose();
      };
    }, `dsh-github-message: ${slot}`);
  };

  // 设置 → 插件里的完整配置页。
  mount(SLOT_NAME, {
    id: PANEL_ID,
    order: 25,
    label: () => t('GitHub 消息'),
  });

  // 插件管理页里本包的配置卡；注册 key 本身就是显示开关。
  mount(BUNDLE_CONFIG_SLOT, { key: PACKAGE_NAME });
}
