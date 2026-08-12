/**
 * 引导期 tip / 本机 member_join 向 roster 补发（打破 join-snapshot attestation 死锁）。
 */
import { stripDagEventLocalExtensions } from 'npm:@steve02081504/fount-p2p/dag/strip_extensions'

import { computeFederatableDagTipIds } from '../dag/eventTypes.mjs'

import { loadLocalFederationArchive } from './archiveHandshake.mjs'
import { localNodeHash, requireDagDeps } from './dagDependencies.mjs'
import { LOGIC_SYNC_PARTITION } from './partitions.mjs'
import { getFederationPartitionSlot } from './registry.mjs'

/**
 * 选出应对指定 peer（或广播）补发的本地事件：联邦 tip + 本机 node 的 member_join。
 * @param {object[]} events 本地 events
 * @param {string} nodeHash 本机 nodeHash
 * @returns {object[]} 待发送事件
 */
export function selectBootstrapFlushEvents(events, nodeHash) {
	if (!events?.length) return []
	const flushIds = new Set(computeFederatableDagTipIds(events))
	for (const event of events)
		if (event.type === 'member_join' && event.node_id === nodeHash)
			flushIds.add(event.id)
	return events.filter(event => flushIds.has(event.id))
}

/**
 * 入群 append 之后：对当前 roster 全员补发 tip + 本机 member_join。
 * 覆盖「先 ensureFederationRoom 再 append」时 onPeerJoin 已跑完、join 还没落盘的竞态。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {Promise<number>} 发送条数（按 peer×事件 累计）
 */
export async function flushBootstrapEventsToRoster(username, groupId) {
	const slot = getFederationPartitionSlot(username, groupId, LOGIC_SYNC_PARTITION)
	if (!slot?.isActive?.()) return 0
	const { readJsonl } = requireDagDeps()
	const { events } = await loadLocalFederationArchive(username, groupId, readJsonl)
	const toSend = selectBootstrapFlushEvents(events, localNodeHash())
	if (!toSend.length) return 0
	const roster = slot.getRoster()
	const peerIds = roster.length ? roster.map(peer => peer.peerId) : [null]
	let sent = 0
	for (const peerId of peerIds)
		for (const event of toSend)
			try {
				slot.send('dag_event', stripDagEventLocalExtensions(event), peerId)
				sent++
			}
			catch (error) { console.error('federation: bootstrap flush failed', error) }
	return sent
}
