/**
 * Chat 联邦加固单元测试（Deno）。
 */
/* global Deno */

import { ms } from 'fount/scripts/ms.mjs'
import {
	pubKeyHash,
	publicKeyFromSeed,
	randomKeyPair,
	sign,
} from 'fount/scripts/p2p/crypto.mjs'
import {
	computeTipConsensusScores,
	selectConsensusBranchTip,
} from 'fount/scripts/p2p/governance_branch.mjs'
import {
	DEFAULT_ICE_SERVERS,
	resolveIceServers,
	sanitizeIceServersForSettings,
} from 'fount/scripts/p2p/ice_servers.mjs'
import {
	messageRateEntityKey,
	resolveMessageRateLimits,
} from 'fount/scripts/p2p/message_rate_limit.mjs'
import { PERMISSIONS } from 'fount/public/parts/shells/chat/src/permissions/chat.mjs'
import {
	parseJoinSnapshotRequest,
	parseJoinSnapshotResponse,
	parsePullResponseEnvelope,
} from 'fount/scripts/p2p/schemas/federation_pull_wire.mjs'
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { findStaleUnreachableChannels } from '../../src/chat/channel/gc.mjs'
import { registerChatEventTypeDefs } from '../../src/chat/dag/eventTypes.mjs'
import { memberChannelPermissions } from '../../src/chat/dag/groupMaterializedState.mjs'
import { parseFedArchiveMonthResponse, parseFedArchiveMonthWant } from '../../src/chat/federation/archiveMonthWire.mjs'
import {
	partitionForOutboundEvent,
	resolveNodePartitionIds,
} from '../../src/chat/federation/partitions.mjs'
import {
	isActivePullMember,
	isHistoricalPullMember,
	pullAttestationSignBytes,
	validatePullAttestationForGroup,
	verifyPullAttestation,
} from '../../src/chat/federation/pullAttestation.mjs'
import { wrapPullResponseInner, unwrapPullResponseEnvelope } from '../../src/chat/federation/pullResponse.mjs'
import { parseGossipRequest } from '../../src/chat/federation/wireSchemas.mjs'

registerChatEventTypeDefs()

const GC_IDLE_MS = ms('30d')

/**
 * 将字节序列编码为十六进制字符串。
 * @param {Uint8Array} bytes 字节序列
 * @returns {string} hex
 */
function bytesToHex(bytes) {
	return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

Deno.test('messageRateEntityKey distinguishes user and char', () => {
	assertEquals(messageRateEntityKey({ sender: 'a'.repeat(64) }), 'a'.repeat(64))
	assertEquals(messageRateEntityKey({ charId: 'bot1', sender: 'a'.repeat(64) }), 'char:bot1')
})

Deno.test('resolveMessageRateLimits clamps values', () => {
	const limits = resolveMessageRateLimits({ messageRateLimitPerMin: 999, messageRateLimitWindowMs: 1000 })
	assertEquals(limits.perMin, 120)
	assertEquals(limits.windowMs, ms('10s'))
})

Deno.test('hasBypassRateLimit respects BYPASS_RATE_LIMIT permission', () => {
	const sender = 'b'.repeat(64)
	const state = {
		members: {
			[sender]: {
				status: 'active',
				roles: ['admin'],
			},
		},
		roles: {
			admin: {
				permissions: { [PERMISSIONS.BYPASS_RATE_LIMIT]: true },
			},
		},
		channels: { default: {} },
	}
	assertEquals(memberChannelPermissions(state, sender, 'default')[PERMISSIONS.BYPASS_RATE_LIMIT], true)
})

Deno.test('joinSnapshot wire parse', () => {
	assertEquals(parseJoinSnapshotRequest(null), null)
	const sender = 'a'.repeat(64)
	const attBody = {
		requesterPubKeyHash: sender,
		groupId: 'g1',
		requestId: 'r1',
		timestamp: Date.now(),
		wantIds: [],
		signature: '00'.repeat(64),
	}
	const req = parseJoinSnapshotRequest({
		requestId: 'r1',
		requesterNodeHash: 'node-a',
		groupId: 'g1',
		attestation: attBody,
	})
	assertEquals(req?.groupId, 'g1')
	assertEquals(req?.requesterPubKeyHash, sender)
	assertEquals(parseJoinSnapshotResponse({
		requestId: 'r1',
		requesterPubKeyHash: sender,
		requesterNodeHash: 'node-a',
		ephemPub: 'x',
		iv: 'y',
		ciphertext: 'z',
		authTag: 'w',
	}), null)
	assertEquals(parseJoinSnapshotResponse({
		requestId: 'r1',
		requesterNodeHash: 'node-a',
		requesterPubKeyHash: sender,
		ephemPub: 'aa',
		iv: 'bb',
		ciphertext: 'cc',
		authTag: 'dd',
	})?.requesterNodeHash, 'node-a')
})

Deno.test('gossip request requires attestation', () => {
	const eventId = 'a'.repeat(64)
	assertEquals(parseGossipRequest({ wantIds: [eventId], ttl: 2, requesterNodeHash: 'n1' }), null)
	const sender = 'b'.repeat(64)
	const att = {
		requesterPubKeyHash: sender,
		groupId: 'g1',
		requestId: '',
		timestamp: Date.now(),
		wantIds: [eventId],
		signature: '11'.repeat(64),
	}
	assertEquals(parseGossipRequest({
		wantIds: [eventId],
		ttl: 2,
		requesterNodeHash: 'n1',
		attestation: att,
	})?.wantIds.length, 1)
})

Deno.test('fed archive month want requires attestation', () => {
	assertEquals(parseFedArchiveMonthWant({
		groupId: 'g1',
		channelId: 'general',
		utcMonth: '2024-01',
		requestId: 'r1',
	}), null)
	const sender = 'c'.repeat(64)
	assertEquals(parseFedArchiveMonthWant({
		groupId: 'g1',
		channelId: 'general',
		utcMonth: '2024-01',
		requestId: 'r1',
		requesterNodeHash: 'n1',
		attestation: {
			requesterPubKeyHash: sender,
			groupId: 'g1',
			requestId: 'r1',
			timestamp: Date.now(),
			signature: '00'.repeat(64),
		},
	})?.requestId, 'r1')
})

Deno.test('fed archive month response requires digest and parts', () => {
	assertEquals(parseFedArchiveMonthResponse({
		requestId: 'r1',
		channelId: 'general',
		utcMonth: '2024-01',
		complete: true,
		body: 'inline forbidden',
	}), null)
	assertEquals(parseFedArchiveMonthResponse({
		requestId: 'r1',
		channelId: 'general',
		utcMonth: '2024-01',
		complete: true,
		digest: 'd'.repeat(64),
		parts: [{ hash: 'e'.repeat(64), size: 0, index: 0 }],
	})?.requestId, 'r1')
})

Deno.test('active pull member rejects kicked', () => {
	const key = 'c'.repeat(64)
	const state = {
		members: {
			[key]: { status: 'active', pubKeyHex: 'd'.repeat(64) },
			['e'.repeat(64)]: { status: 'kicked', pubKeyHex: 'f'.repeat(64) },
		},
	}
	assertEquals(isActivePullMember(state, key), true)
	assertEquals(isActivePullMember(state, 'e'.repeat(64)), false)
})

Deno.test('historical pull member policy', () => {
	const key = 'c'.repeat(64)
	const state = {
		members: {
			[key]: { status: 'active', pubKeyHex: 'd'.repeat(64) },
			['e'.repeat(64)]: { status: 'kicked' },
			['f'.repeat(64)]: { status: 'left' },
			['g'.repeat(64)]: { status: 'banned' },
		},
	}
	assertEquals(isHistoricalPullMember(state, key), true)
	assertEquals(isHistoricalPullMember(state, 'e'.repeat(64)), true)
	assertEquals(isHistoricalPullMember(state, 'f'.repeat(64)), true)
	assertEquals(isHistoricalPullMember(state, 'g'.repeat(64)), false)
	assertEquals(isHistoricalPullMember(state, 'h'.repeat(64)), false)
})

Deno.test('pull attestation sign and verify', async () => {
	const kp = await randomKeyPair()
	const body = {
		requesterPubKeyHash: 'a'.repeat(64),
		groupId: 'g-test',
		requestId: 'req-1',
		timestamp: Date.now(),
		wantIds: ['b'.repeat(64)],
		signature: '',
	}
	const sig = await sign(pullAttestationSignBytes(body), kp.secretKey)
	body.signature = bytesToHex(sig)
	const ok = await verifyPullAttestation(body, 'g-test', kp.publicKey)
	assertEquals(ok, true)
	assertEquals(await verifyPullAttestation(body, 'other-group', kp.publicKey), false)
})

Deno.test('validatePullAttestationForGroup member gate', async () => {
	const kp = await randomKeyPair()
	const edPub = publicKeyFromSeed(kp.secretKey)
	const sender = pubKeyHash(edPub)
	const pubHex = bytesToHex(edPub)
	const body = {
		requesterPubKeyHash: sender,
		groupId: 'g-gate',
		requestId: 'req-gate',
		timestamp: Date.now(),
		wantIds: [],
		signature: '',
	}
	body.signature = bytesToHex(await sign(pullAttestationSignBytes(body), kp.secretKey))
	assertEquals(await validatePullAttestationForGroup({ members: {} }, 'g-gate', body), false)
	const kicked = {
		members: {
			[sender]: { status: 'kicked', pubKeyHex: pubHex },
		},
	}
	assertEquals(await validatePullAttestationForGroup(kicked, 'g-gate', body), true)
})

Deno.test('pull response rejects plaintext gossip shape', () => {
	const eventId = 'a'.repeat(64)
	assertEquals(parsePullResponseEnvelope({ events: [{ id: eventId }], checkpoint: {} }), null)
	assertEquals(parsePullResponseEnvelope({
		channelHistories: { default: [{ type: 'message' }] },
		requesterNodeHash: 'n1',
	}), null)
})

Deno.test('HPKE pull envelope roundtrip', async () => {
	const recipient = await randomKeyPair()
	const inner = { fileKeyWraps: { generations: [] }, events: [] }
	const wrapped = wrapPullResponseInner(bytesToHex(recipient.publicKey), inner)
	const envelope = {
		requestId: 'r1',
		requesterPubKeyHash: 'a'.repeat(64),
		requesterNodeHash: 'node-1',
		...wrapped,
	}
	assertEquals(parsePullResponseEnvelope(envelope)?.requestId, 'r1')
	const out = unwrapPullResponseEnvelope(envelope, recipient.secretKey)
	assertEquals(Array.isArray(out?.events), true)
})

Deno.test('resolveIceServers filters invalid URLs', () => {
	const servers = resolveIceServers({
		iceServers: [
			{ urls: 'http://bad' },
			{ urls: 'stun:stun.example.com:3478' },
			{ urls: 'turn:turn.example.com', username: 'u', credential: 'p' },
		],
	})
	assertEquals(servers.length, 2)
	assertEquals(servers[0].urls, 'stun:stun.example.com:3478')
})

Deno.test('sanitizeIceServers requires credential pair', () => {
	const out = sanitizeIceServersForSettings([
		{ urls: 'turn:t.example.com', username: 'u' },
	])
	assertEquals(out[0]?.urls, DEFAULT_ICE_SERVERS[0].urls)
})

Deno.test('consensus branch prefers higher governance count', () => {
	const a1 = 'a'.repeat(64)
	const t1 = 'b'.repeat(64)
	const b1 = 'c'.repeat(64)
	const t2 = 'd'.repeat(64)
	const tips = [t1, t2]
	const byId = new Map([
		[a1, { id: a1, type: 'role_create', prev_event_ids: [] }],
		[t1, { id: t1, type: 'message', prev_event_ids: [a1] }],
		[b1, { id: b1, type: 'message', prev_event_ids: [] }],
		[t2, { id: t2, type: 'message', prev_event_ids: [b1] }],
	])
	assertEquals(selectConsensusBranchTip(tips, byId), t1)
	const scores = computeTipConsensusScores(tips, byId)
	assertEquals(scores[t1] > scores[t2], true)
})

Deno.test('federation collapses to a single sync partition (one room per group)', () => {
	const settings = { federationPartitionCount: 8 }
	const partitions = resolveNodePartitionIds(settings, 'channel-alpha')
	assertEquals(partitions, ['sync'])
	const pid = partitionForOutboundEvent('message', 'channel-alpha', settings)
	assertEquals(pid, 'sync')
})

Deno.test('mergeChannelMessagesForDisplay marks edited messages', async () => {
	const { mergeChannelMessagesForDisplay } = await import('../../public/shared/messageMerge.mjs')
	const baseId = 'a'.repeat(64)
	const editId = 'b'.repeat(64)
	const rows = [
		{ type: 'message', eventId: baseId, content: { type: 'text', content: 'hi' } },
		{
			type: 'message_edit',
			eventId: editId,
			content: { targetId: baseId, newContent: { type: 'text', content: 'edited' } },
		},
	]
	const merged = mergeChannelMessagesForDisplay(rows)
	assertEquals(merged.length, 1)
	assertEquals(merged[0].wasEdited, true)
	assertEquals(merged[0].content.content, 'edited')
})

Deno.test('mergeChannelMessagesForDisplay preserves displayName from message_edit', async () => {
	const { mergeChannelMessagesForDisplay } = await import('../../public/shared/messageMerge.mjs')
	const baseId = 'a'.repeat(64)
	const rows = [
		{
			type: 'message',
			eventId: baseId,
			content: {
				type: 'text',
				content: '',
				displayName: 'host',
				displayAvatar: '👤',
				is_generating: true,
			},
		},
		{
			type: 'message_edit',
			eventId: 'b'.repeat(64),
			content: {
				targetId: baseId,
				newContent: {
					type: 'text',
					content: 'char reply',
					displayName: '写路径 Agent',
					displayAvatar: '🤖',
					is_generating: false,
				},
			},
		},
	]
	const merged = mergeChannelMessagesForDisplay(rows)
	assertEquals(merged[0].content.displayName, '写路径 Agent')
	assertEquals(merged[0].content.displayAvatar, '🤖')
	assertEquals(merged[0].content.content, 'char reply')
})

Deno.test('channel GC skips default channel', () => {
	const nowMs = 1_700_000_000_000
	const state = {
		groupSettings: { defaultChannelId: 'default' },
		channels: { default: { id: 'default' } },
	}
	assertEquals(findStaleUnreachableChannels(state, [], nowMs), [])
})

Deno.test('channel GC skips reachable stale child', () => {
	const nowMs = 1_700_000_000_000
	const state = {
		groupSettings: { defaultChannelId: 'default' },
		channels: {
			default: { id: 'default' },
			child: { id: 'child', parentChannelId: 'default' },
		},
	}
	const events = [{
		type: 'message',
		channelId: 'child',
		hlc: { wall: nowMs - GC_IDLE_MS - 1 },
	}]
	assertEquals(findStaleUnreachableChannels(state, events, nowMs), [])
})

Deno.test('channel GC collects unreachable stale channel', () => {
	const nowMs = 1_700_000_000_000
	const state = {
		groupSettings: { defaultChannelId: 'default' },
		channels: {
			default: { id: 'default' },
			orphan: { id: 'orphan' },
		},
	}
	const events = [{
		type: 'message',
		channelId: 'orphan',
		hlc: { wall: nowMs - GC_IDLE_MS - 1 },
	}]
	assertEquals(findStaleUnreachableChannels(state, events, nowMs), ['orphan'])
})

Deno.test('channel GC skips unreachable but recently active', () => {
	const nowMs = 1_700_000_000_000
	const state = {
		groupSettings: { defaultChannelId: 'default' },
		channels: {
			default: { id: 'default' },
			orphan: { id: 'orphan' },
		},
	}
	const events = [{ type: 'message', channelId: 'orphan', hlc: { wall: nowMs - 1000 } }]
	assertEquals(findStaleUnreachableChannels(state, events, nowMs), [])
})

Deno.test('channel GC skips channel linked from list manualItems', () => {
	const nowMs = 1_700_000_000_000
	const state = {
		groupSettings: { defaultChannelId: 'default' },
		channels: {
			default: {
				id: 'default',
				type: 'list',
				manualItems: [{ targetChannelId: 'linked' }],
			},
			linked: { id: 'linked' },
			orphan: { id: 'orphan' },
		},
	}
	const events = [
		{ type: 'message', channelId: 'linked', hlc: { wall: nowMs - GC_IDLE_MS - 1 } },
		{ type: 'message', channelId: 'orphan', hlc: { wall: nowMs - GC_IDLE_MS - 1 } },
	]
	assertEquals(findStaleUnreachableChannels(state, events, nowMs), ['orphan'])
})
