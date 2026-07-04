/**
 * P2P network / denylist 纯函数单元测试（Deno）。
 */
/* global Deno */
import { placeholderEntityHash } from 'fount/scripts/test/fixtures.mjs'
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { normalizeDenylist } from '../../denylist.mjs'
import { normalizeNetwork, isPeerPoolKeyBlocked } from '../../network.mjs'

const NODE_A = `${'a'.repeat(64)}`
const NODE_B = `${'b'.repeat(64)}`
const ENTITY = placeholderEntityHash('c')

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

Deno.test('normalizeDenylist entity scope requires 128 hex', () => {
	const list = normalizeDenylist({
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

Deno.test('normalizeDenylist drops entity scope groupId', () => {
	const list = normalizeDenylist({
		blocked: [{ scope: 'entity', value: ENTITY, groupId: 'g1' }],
	})
	assertEquals(list.blocked.length, 1)
	assertEquals(list.blocked[0].groupId, undefined)
})

Deno.test('isPeerPoolKeyBlocked matches deny scopes separately', () => {
	const view = {
		trustedPeers: [],
		explorePeers: [],
		blockedPeers: [NODE_A],
		deniedNodes: [NODE_A],
		deniedSubjects: [NODE_B],
		deniedEntities: [ENTITY],
		lastRosterAt: 0,
	}
	assertEquals(isPeerPoolKeyBlocked(view, NODE_A), true)
	assertEquals(isPeerPoolKeyBlocked(view, NODE_B), true)
	assertEquals(isPeerPoolKeyBlocked(view, ENTITY), true)
	assertEquals(isPeerPoolKeyBlocked(view, `${'e'.repeat(64)}`), false)
})
