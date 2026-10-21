/**
 * resolveViewerFriendBinding：DM 群的好友绑定必须按查看者还原对端。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { resolveViewerFriendBinding } from '../../public/shared/friendBinding.mjs'

const CREATOR_ENTITY = 'a'.repeat(128)
const PEER_ENTITY = 'b'.repeat(128)
const CREATOR_KEY = '1'.repeat(64)
const PEER_KEY = '2'.repeat(64)
const AGENT_ENTITY = 'c'.repeat(128)
const AGENT_KEY = '3'.repeat(64)

/**
 * @param {object} [overrides] 覆盖项
 * @returns {object} 物化群状态片段
 */
function dmState(overrides = {}) {
	return {
		groupMeta: { dmKind: 'ecdh', friendBinding: { entityHash: PEER_ENTITY } },
		members: {
			[CREATOR_KEY]: { status: 'active', memberKind: 'user', entityHash: CREATOR_ENTITY },
			[PEER_KEY]: { status: 'active', memberKind: 'user', entityHash: PEER_ENTITY },
		},
		...overrides,
	}
}

Deno.test('resolveViewerFriendBinding keeps the creator view and flips it for the invited side', () => {
	const state = dmState()
	assertEquals(resolveViewerFriendBinding(state, CREATOR_KEY), { entityHash: PEER_ENTITY })
	// 同一份联邦元数据：受邀方眼里的对端是建群者，不是自己。
	assertEquals(resolveViewerFriendBinding(state, PEER_KEY), { entityHash: CREATOR_ENTITY })
})

Deno.test('resolveViewerFriendBinding synthesizes a peer for a DM that never stored a binding', () => {
	const state = dmState({ groupMeta: { dmKind: 'ecdh', friendBinding: null } })
	assertEquals(resolveViewerFriendBinding(state, PEER_KEY), { entityHash: CREATOR_ENTITY })
	assertEquals(resolveViewerFriendBinding(state, CREATOR_KEY), { entityHash: PEER_ENTITY })
})

Deno.test('resolveViewerFriendBinding keeps the stored binding while the peer has not joined yet', () => {
	const state = dmState({
		members: { [CREATOR_KEY]: { status: 'active', memberKind: 'user', entityHash: CREATOR_ENTITY } },
	})
	assertEquals(resolveViewerFriendBinding(state, CREATOR_KEY), { entityHash: PEER_ENTITY })
})

Deno.test('resolveViewerFriendBinding ignores agent members and leaves non-DM groups alone', () => {
	const withAgent = dmState()
	withAgent.members[AGENT_KEY] = { status: 'active', memberKind: 'agent', entityHash: AGENT_ENTITY }
	assertEquals(resolveViewerFriendBinding(withAgent, PEER_KEY), { entityHash: CREATOR_ENTITY })

	const normalGroup = dmState({ groupMeta: { friendBinding: { entityHash: PEER_ENTITY } } })
	assertEquals(resolveViewerFriendBinding(normalGroup, PEER_KEY), { entityHash: PEER_ENTITY })
	assertEquals(resolveViewerFriendBinding(normalGroup, CREATOR_KEY), { entityHash: PEER_ENTITY })
})

Deno.test('resolveViewerFriendBinding falls back to the stored binding without a local member or with 3 users', () => {
	const state = dmState()
	assertEquals(resolveViewerFriendBinding(state, null), { entityHash: PEER_ENTITY })

	state.members['4'.repeat(64)] = { status: 'active', memberKind: 'user', entityHash: 'd'.repeat(128) }
	assertEquals(resolveViewerFriendBinding(state, PEER_KEY), { entityHash: PEER_ENTITY })
})
