/**
 * Chat 打开 emoji picker 会懒加载 social 并打 /emoji-packs/available。
 * 列表路径上的联邦 sync 不得拖死该请求（否则 picker rail 永远不渲染）。
 */
/* global Deno */
import { assert } from 'jsr:@std/assert'

import { createTestSession } from '../harness.mjs'

const getSession = createTestSession({ username: 'social-emoji-avail-latency' })

Deno.test({
	name: 'listAvailableEntityPacksForUser returns promptly for local-only viewer',
	sanitizeOps: false,
	sanitizeResources: false,
}, async () => {
	const { username, operator } = await getSession()
	const { listAvailableEntityPacksForUser } = await import('../../src/emojiPacks.mjs')

	const started = Date.now()
	const packs = await listAvailableEntityPacksForUser(username, { viewerEntityHash: operator })
	const elapsed = Date.now() - started

	assert(Array.isArray(packs))
	// 预算名义 2.5s；本机仅自身 owner 时不应接近联邦多轮超时。
	assert(elapsed < 5_000, `listAvailable took ${elapsed}ms (expected <5000)`)
})
