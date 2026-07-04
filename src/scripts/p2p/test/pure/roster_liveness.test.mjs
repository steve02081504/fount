/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	createPeerIdentityMaps,
	partitionRosterByLiveness,
	pruneStaleRosterEntries,
} from '../../trystero_session.mjs'

const NODE_A = 'a'.repeat(64)
const NODE_B = 'b'.repeat(64)

Deno.test('partitionRosterByLiveness splits live vs stale by live peerId set', () => {
	const roster = [
		{ peerId: 'p-live', remoteNodeHash: NODE_A },
		{ peerId: 'p-stale', remoteNodeHash: NODE_B },
	]
	const { live, stale } = partitionRosterByLiveness(roster, ['p-live'])
	assertEquals(live.map(e => e.peerId), ['p-live'])
	assertEquals(stale.map(e => e.peerId), ['p-stale'])
})

Deno.test('partitionRosterByLiveness: empty live set => all stale; skips entries without peerId', () => {
	const roster = [
		{ peerId: 'p1', remoteNodeHash: NODE_A },
		{ peerId: '', remoteNodeHash: NODE_B },
		{ remoteNodeHash: NODE_B },
	]
	const { live, stale } = partitionRosterByLiveness(roster, [])
	assertEquals(live.length, 0)
	assertEquals(stale.map(e => e.peerId), ['p1'])
})

Deno.test('pruneStaleRosterEntries drops dead peers from both maps and self-heals', () => {
	const peerToNode = new Map([['p-live', NODE_A], ['p-stale', NODE_B]])
	const nodeToPeer = new Map([[NODE_A, 'p-live'], [NODE_B, 'p-stale']])

	const stale = pruneStaleRosterEntries(peerToNode, nodeToPeer, new Set(['p-live']))

	assertEquals(stale.map(e => e.peerId), ['p-stale'])
	assertEquals([...peerToNode.entries()], [['p-live', NODE_A]])
	assertEquals([...nodeToPeer.entries()], [[NODE_A, 'p-live']])
})

Deno.test('pruneStaleRosterEntries keeps nodeToPeer when a live peer already re-claimed that nodeHash', () => {
	// 旧 peerId 失效，但同一 nodeHash 已被新 live peerId 重新认领（identity_announce 已更新 nodeToPeer）。
	// 剔除旧 peerId 不应误删指向新 live peer 的 nodeToPeer 映射。
	const peerToNode = new Map([['p-old', NODE_A], ['p-new', NODE_A]])
	const nodeToPeer = new Map([[NODE_A, 'p-new']])

	const stale = pruneStaleRosterEntries(peerToNode, nodeToPeer, new Set(['p-new']))

	assertEquals(stale.map(e => e.peerId), ['p-old'])
	assertEquals([...peerToNode.entries()], [['p-new', NODE_A]])
	assertEquals(nodeToPeer.get(NODE_A), 'p-new')
})

Deno.test('createPeerIdentityMaps getRoster reconciles against live peers and fires onStalePruned', () => {
	let live = new Set(['p1', 'p2'])
	const pruned = []
	/** @returns {Set<string>} 当前活连接 peerId */
	const getLivePeerIds = () => live
	/**
	 * @param {Array<{ peerId: string }>} stale 被剔除条目
	 * @returns {void}
	 */
	const onStalePruned = stale => { pruned.push(...stale.map(e => e.peerId)) }
	const maps = createPeerIdentityMaps({ getLivePeerIds, onStalePruned })
	maps.peerToNode.set('p1', NODE_A)
	maps.peerToNode.set('p2', NODE_B)
	maps.nodeToPeer.set(NODE_A, 'p1')
	maps.nodeToPeer.set(NODE_B, 'p2')

	assertEquals(maps.getRoster().map(e => e.peerId).sort(), ['p1', 'p2'])
	assertEquals(pruned.length, 0)

	// p2 掉线（不在活连接里）：下一次 getRoster 自愈剔除并回调观测。
	live = new Set(['p1'])
	assertEquals(maps.getRoster().map(e => e.peerId), ['p1'])
	assertEquals(maps.getPeerIdByNodeHash(NODE_B), null)
	assertEquals(pruned, ['p2'])
})

Deno.test('createPeerIdentityMaps without getLivePeerIds keeps legacy (no reconcile)', () => {
	const maps = createPeerIdentityMaps()
	maps.peerToNode.set('p-gone', NODE_A)
	maps.nodeToPeer.set(NODE_A, 'p-gone')
	// 未注入 getLivePeerIds：保持原行为，不做存活剔除。
	assertEquals(maps.getRoster().map(e => e.peerId), ['p-gone'])
	assertEquals(maps.getPeerIdByNodeHash(NODE_A), 'p-gone')
})
