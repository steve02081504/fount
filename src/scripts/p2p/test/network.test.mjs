/**
 * P2P network / blocklist 纯函数单元测试（Deno）。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { normalizeBlocklist } from '../blocklist.mjs'
import { normalizeNetwork } from '../network.mjs'

const NODE_A = `${'a'.repeat(64)}`
const NODE_B = `${'b'.repeat(64)}`
const ENTITY = `${'c'.repeat(128)}`

Deno.test('normalizeNetwork dedupes peers and trims hints', () => {
	const net = normalizeNetwork({
		trustedPeers: [NODE_A, NODE_A.toUpperCase()],
		explorePeers: [NODE_B],
		hints: [
			{ nodeHash: NODE_B, source: 'social', kind: 'mention', expiresAt: Date.now() + 1e6 },
			{ nodeHash: 'bad', source: 'x', kind: 'y', expiresAt: 0 },
		],
	})
	assertEquals(net.trustedPeers, [NODE_A])
	assertEquals(net.explorePeers, [NODE_B])
	assertEquals(net.hints.length, 1)
	assertEquals(net.hints[0].nodeHash, NODE_B)
})

Deno.test('normalizeBlocklist entity scope requires 128 hex', () => {
	const list = normalizeBlocklist({
		blocked: [
			{ scope: 'entity', value: ENTITY },
			{ scope: 'entity', value: 'not-valid' },
			{ scope: 'node', value: NODE_A },
		],
	})
	assertEquals(list.blocked.length, 2)
	assertEquals(list.blocked[0].scope, 'entity')
	assertEquals(list.blocked[0].value, ENTITY)
	assertEquals(list.blocked[1].scope, 'node')
})
