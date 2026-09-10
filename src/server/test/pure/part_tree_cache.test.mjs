/**
 * part 树缓存复用策略：持久化缓存未在本进程重扫前不得复用。
 */
/* global Deno */
import { assert } from 'jsr:@std/assert'

import { canReusePartTreeCache } from '../../parts_loader.mjs'

const completeCache = { branches: { chars: {} }, registries: { locales: [] } }

Deno.test('canReusePartTreeCache reuses only after a fresh scan this process', () => {
	assert(canReusePartTreeCache({ nocache: false }, true, completeCache, completeCache))
})

Deno.test('canReusePartTreeCache refuses a persisted cache not yet validated this process', () => {
	assert(!canReusePartTreeCache({ nocache: false }, false, completeCache, completeCache))
})

Deno.test('canReusePartTreeCache always scans a brand-new user with no cache file', () => {
	// 新用户没有持久化缓存：loadData 返回 {}，无论本次进程是否验证过都必须重扫。
	assert(!canReusePartTreeCache({ nocache: false }, false, {}, {}))
	assert(!canReusePartTreeCache({ nocache: false }, true, {}, {}))
})

Deno.test('canReusePartTreeCache respects nocache and incomplete caches', () => {
	assert(!canReusePartTreeCache({ nocache: true }, true, completeCache, completeCache))
	assert(!canReusePartTreeCache({ nocache: false }, true, {}, completeCache))
	assert(!canReusePartTreeCache({ nocache: false }, true, completeCache, {}))
})
