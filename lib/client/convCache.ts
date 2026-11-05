"use client";

import { api } from "./api";
import type { Conversation } from "../types";

/**
 * 对话内容的前端缓存：
 * - 鼠标移到左栏的对话上（手机上是按下时）就开始预取，点开时大多已经到了
 * - 打开过的对话再回来时先显示缓存，同时在后台向服务端确认是不是最新
 * - 本页保存对话时同步更新缓存
 */
const cache = new Map<string, Conversation>();
const inflight = new Map<string, Promise<Conversation | null>>();
const MAX = 30;

function remember(c: Conversation) {
  cache.delete(c.id);
  cache.set(c.id, c);
  while (cache.size > MAX) cache.delete(cache.keys().next().value as string);
}

/** 从服务端取对话（同一个 id 同时只发一个请求）；不存在时返回 null */
export function fetchConv(id: string): Promise<Conversation | null> {
  const going = inflight.get(id);
  if (going) return going;
  const p = api<{ conversation: Conversation }>(`/api/conversations/${id}`)
    .then(({ conversation }) => {
      const cur = cache.get(id);
      // 不覆盖本页刚保存的更新版本
      if (!cur || (conversation.updatedAt || 0) >= (cur.updatedAt || 0)) remember(conversation);
      return cache.get(id) || conversation;
    })
    .catch((e: Error & { status?: number }) => {
      if (e.status === 404) {
        cache.delete(id);
        return null;
      }
      throw e;
    })
    .finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

export function prefetchConv(id: string) {
  if (cache.has(id) || inflight.has(id)) return;
  fetchConv(id).catch(() => {});
}

export function peekConv(id: string) {
  return cache.get(id);
}

export function putConv(c: Conversation) {
  remember(c);
}

export function dropConv(id: string) {
  cache.delete(id);
}

/** 服务端随页面一起发来的对话内容只用一次：前进后退时路由缓存里的是旧数据，那时要重新取 */
const used = new WeakSet<object>();
export function takeInitial<T extends object>(p: T | undefined): T | undefined {
  if (!p || used.has(p)) return undefined;
  used.add(p);
  return p;
}
