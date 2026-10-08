/**
 * DM 群「对方是本群天然成员、不需要邀请码」这条豁免的真实语义：
 * 比较的必须是 member_join 的实体活跃公钥（`entityActivePubKeyHex`，已由 authorizeEvent 验签+验归属），
 * 而不是 `event.sender`（per-group signer 的 pubKeyHash —— 与实体公钥不是同一命名空间，拿它比对永远为 false）。
 */
/* global Deno */
import { assertEquals, assertRejects } from 'jsr:@std/assert'

import { validateJoinPolicy } from '../../src/chat/governance/joinPolicy.mjs'

const OWNER_SIGNER = '1'.repeat(64)
const PEER_SIGNER = '2'.repeat(64)
const STRANGER_SIGNER = '3'.repeat(64)
const OWNER_ENTITY_PUB_KEY = 'a'.repeat(64)
const PEER_ENTITY_PUB_KEY = 'b'.repeat(64)
const STRANGER_ENTITY_PUB_KEY = 'c'.repeat(64)

/**
 * 构造已有一名 active 成员的 invite-only ECDH DM 群状态桩。
 * @returns {object} 物化群状态桩
 */
function dmState() {
	return {
		groupId: '11111111-2222-3333-4444-555555555555',
		groupSettings: { joinPolicy: 'invite-only' },
		groupMeta: {
			dmKind: 'ecdh',
			dmSessionTag: 'd'.repeat(64),
			dmPubKeyLow: PEER_ENTITY_PUB_KEY < OWNER_ENTITY_PUB_KEY ? PEER_ENTITY_PUB_KEY : OWNER_ENTITY_PUB_KEY,
			dmPubKeyHigh: PEER_ENTITY_PUB_KEY < OWNER_ENTITY_PUB_KEY ? OWNER_ENTITY_PUB_KEY : PEER_ENTITY_PUB_KEY,
			dmPeerPubKeyHex: PEER_ENTITY_PUB_KEY,
			dmMyPubKeyHex: OWNER_ENTITY_PUB_KEY,
		},
		roles: { '@everyone': {} },
		members: { [OWNER_SIGNER]: { status: 'active', entityHash: `${'9'.repeat(64)}${'9'.repeat(64)}` } },
	}
}

Deno.test('the DM peer entity joins without an invite code (entity active key, not the signer key)', async () => {
	await validateJoinPolicy(dmState(), {
		type: 'member_join',
		sender: PEER_SIGNER,
		timestamp: 2,
		content: { entityHash: `${'8'.repeat(64)}${'8'.repeat(64)}`, entityActivePubKeyHex: PEER_ENTITY_PUB_KEY },
	}, 'u')
})

Deno.test('an unrelated entity still needs an invite code in a DM group', async () => {
	await assertRejects(
		() => validateJoinPolicy(dmState(), {
			type: 'member_join',
			sender: STRANGER_SIGNER,
			timestamp: 3,
			content: { entityHash: `${'7'.repeat(64)}${'7'.repeat(64)}`, entityActivePubKeyHex: STRANGER_ENTITY_PUB_KEY },
		}, 'u'),
		Error,
		'member_join requires inviteCode',
	)
})

Deno.test('a per-group signer key equal to the DM peer key is not a free pass', async () => {
	// 旧实现比较的正是 event.sender：这条以前会被误放行，现在必须按实体公钥拒绝。
	const state = dmState()
	await assertRejects(
		() => validateJoinPolicy(state, {
			type: 'member_join',
			sender: PEER_ENTITY_PUB_KEY,
			timestamp: 4,
			content: { entityHash: `${'6'.repeat(64)}${'6'.repeat(64)}`, entityActivePubKeyHex: STRANGER_ENTITY_PUB_KEY },
		}, 'u'),
		Error,
		'member_join requires inviteCode',
	)
})

Deno.test('a member_join without entity binding fields is not treated as the DM peer', async () => {
	const state = dmState()
	const error = await validateJoinPolicy(state, {
		type: 'member_join',
		sender: PEER_ENTITY_PUB_KEY,
		timestamp: 5,
		content: {},
	}, 'u').then(() => null, caught => caught)
	assertEquals(error?.message, 'member_join requires inviteCode')
})
