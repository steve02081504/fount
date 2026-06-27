/**
 * 联邦闭门羹 fed_shun：拒绝服务时不泄露群内容，仅告知请求方“不伺候你”。
 */
import { randomUUID } from 'node:crypto'

import { clampNumber } from '../../../../../../../scripts/clamp.mjs'
import { createDedupeSlot } from '../../../../../../../scripts/p2p/dedupe_slot.mjs'
import { isHex64, normalizeHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { loadGroupShunState, saveGroupShunState, SHUN_CONSENSUS_WINDOW_MS, updateGroupShunState } from '../../group/groupShunState.mjs'

import { loadLocalFederationArchive } from './archiveHandshake.mjs'
import { federationNodeHash, loadFederationMaterializedState, requireDagDeps } from './deps.mjs'
import { signPullAttestation } from './pullAttestation.mjs'

/** 出站 fed_shun 限流：同群同请求方 30s 内至多一发。 */
const takeOutboundShunSlot = createDedupeSlot({ maxSize: 4000, ttlMs: 30_000 })

/**
 * 主动探测的冷却安全网：尚无任何新鲜 shun 信号时，最多每此间隔向全员探测一次。
 * 与共识窗口解耦——窗口内的 shun 始终计入，但冷启动探测需更频繁，
 * 否则一次探测因 P2P 尚未连通而落空后，被移除方要等满共识窗口才会重试，迟迟无法自判出局。
 */
const SHUN_PROBE_COOLDOWN_MS = 30_000

/**
 * 从物化 state 收集已知 active 成员 homeNodeHash（去掉本机）。
 * 若提供 rosterNodeHashes，优先取与 MQTT 房内可见节点的交集；交集为空时退化为 roster 内除己外的节点。
 * @param {object | null | undefined} state 物化群状态
 * @param {string} selfNodeHash 本机 nodeHash
 * @param {string[] | null | undefined} [rosterNodeHashes] 联邦房内可见 nodeHash
 * @returns {string[]} 去重 nodeHash 列表
 */
export function collectKnownPeerNodeHashes(state, selfNodeHash, rosterNodeHashes = null) {
	const self = normalizeHex64(selfNodeHash) || ''
	const rosterSet = rosterNodeHashes?.length
		? new Set(rosterNodeHashes.map(id => normalizeHex64(id)).filter(isHex64))
		: null
	const fromMembers = new Set()
	for (const member of Object.values(state?.members || {})) {
		if (member?.status !== 'active') continue
		const home = normalizeHex64(member.homeNodeHash)
		if (isHex64(home) && home !== self) fromMembers.add(home)
	}
	if (!rosterSet?.size) return [...fromMembers]
	const fromRoster = [...rosterSet].filter(h => h !== self)
	if (fromRoster.length) return fromRoster
	return [...fromMembers]
}

/**
 * 纯函数：是否满足“已知成员节点全部在窗口内发过 shun”。
 * @param {string[]} knownPeerNodeHashes 已知对端 nodeHash（除己）
 * @param {Record<string, number>} shunsByNode nodeHash → 收到 shun 的时间戳
 * @param {number} [nowMs] 当前时间
 * @param {number} [windowMs] 共识窗口
 * @returns {{ suspected: boolean, shunnedBy: string[] }} 是否疑似出局与窗口内 shun 来源
 */
export function evaluateShunConsensusPure(knownPeerNodeHashes, shunsByNode, nowMs = Date.now(), windowMs = SHUN_CONSENSUS_WINDOW_MS) {
	const peers = [...new Set((knownPeerNodeHashes || []).map(id => String(id).trim().toLowerCase()).filter(isHex64))]
	if (!peers.length) return { suspected: false, shunnedBy: [] }
	const shunnedBy = peers.filter(nodeHash => {
		const at = shunsByNode[nodeHash]
		return Number.isFinite(at) && nowMs - at < windowMs
	})
	return {
		suspected: shunnedBy.length === peers.length,
		shunnedBy,
	}
}

/**
 * @param {object | null | undefined} fedState 物化群状态
 * @param {(subject: string) => boolean} isBlockedPeer 拉黑检查
 * @param {string} requesterPubKeyHash 请求方 pubKeyHash
 * @returns {{ shun: boolean, reason: 'not_a_member' | 'blocked' | null }} 是否应回闭门羹
 */
export function resolveShunForPubKeyRequester(fedState, isBlockedPeer, requesterPubKeyHash) {
	const pk = normalizeHex64(requesterPubKeyHash)
	if (!pk) return { shun: false, reason: null }
	if (isBlockedPeer(pk)) return { shun: true, reason: 'blocked' }
	const member = fedState?.members?.[pk]
	if (!member || member.status !== 'active') return { shun: true, reason: 'not_a_member' }
	return { shun: false, reason: null }
}

/**
 * 向对端发送 fed_shun（限流、无签名、最小载荷）。
 * @param {{ enqueue: (priority: number, run: () => void) => void }} fedOut 出站队列
 * @param {(payload: unknown, peerId: string) => void} fedShunSend Trystero send
 * @param {string} groupId 群 ID
 * @param {string} localNodeHash 本机 nodeHash
 * @param {string} requesterNodeHash 请求方 nodeHash（限流键）
 * @param {string} peerId Trystero peer
 * @param {'not_a_member' | 'blocked'} reason 闭门羹原因
 * @returns {void}
 */
export function sendFedShun(fedOut, fedShunSend, groupId, localNodeHash, requesterNodeHash, peerId, reason) {
	if (!peerId) return
	const dedupeKey = `${groupId}:${requesterNodeHash}:${reason}`
	if (!takeOutboundShunSlot(dedupeKey)) return
	const payload = {
		groupId,
		nodeHash: localNodeHash,
		reason,
	}
	fedOut.enqueue(4, () => {
		if (!peerId) return
		try { fedShunSend(payload, peerId) }
		catch (error) { console.error('federation: fed_shun send failed', error) }
	})
}

/**
 * 记录入站 fed_shun 并重新评估疑似出局。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} fromNodeHash 发送方 nodeHash
 * @param {string} reason 闭门羹原因
 * @returns {Promise<ReturnType<typeof loadGroupShunState>>} 更新后状态
 */
export async function recordInboundShun(username, groupId, fromNodeHash, reason) {
	const nodeHash = normalizeHex64(fromNodeHash)
	if (!isHex64(nodeHash)) return loadGroupShunState(username, groupId)
	const now = Date.now()
	// 锁内基于最新状态合并：并发的多个 shun 入站不会互相覆盖 shunsByNode。
	return updateGroupShunState(username, groupId, prev => ({
		shunsByNode: { ...prev.shunsByNode, [nodeHash]: now },
		shunnedBy: [...new Set([...prev.shunnedBy, nodeHash])],
	}))
}

/**
 * 读取联邦同步房名册中可见对端的 nodeHash（联邦房不可用/单测环境下返回 null）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {Promise<string[] | null>} nodeHash 列表或 null
 */
async function loadRosterNodeHashes(username, groupId) {
	try {
		const { getFederationPartitionSlot } = await import('./registry.mjs')
		const { LOGIC_SYNC_PARTITION } = await import('./partitions.mjs')
		const slot = getFederationPartitionSlot(username, groupId, LOGIC_SYNC_PARTITION)
		return slot
			? slot.getRoster().map(peer => normalizeHex64(peer?.nodeHash)).filter(isHex64)
			: null
	}
	catch { return null /* federation room may be unavailable in unit tests */ }
}

/**
 * @param {Record<string, number>} shunsByNode nodeHash → 收到 shun 时间戳
 * @param {number} nowMs 当前时间
 * @returns {boolean} 是否存在共识窗口内的新鲜 shun
 */
function hasFreshShun(shunsByNode, nowMs) {
	for (const at of Object.values(shunsByNode))
		if (Number.isFinite(at) && nowMs - at < SHUN_CONSENSUS_WINDOW_MS) return true
	return false
}

/**
 * 根据本地物化成员名册与 shun 记录评估是否疑似出局。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {{ shunState?: Awaited<ReturnType<typeof loadGroupShunState>> }} [opts] 复用已加载的 shun 状态，省去重复读盘
 * @returns {Promise<ReturnType<typeof loadGroupShunState>>} 更新后状态
 */
export async function evaluateShunConsensus(username, groupId, opts = {}) {
	const prev = opts.shunState ?? await loadGroupShunState(username, groupId)
	// 从未收到任何 shun 且当前未疑似出局：无可评估，跳过物化与名册读取。
	if (!prev.suspectedRemoved && !Object.keys(prev.shunsByNode).length) return prev
	const selfNodeHash = federationNodeHash(username)
	const fedState = await loadFederationMaterializedState(username, groupId)
	const rosterNodeHashes = await loadRosterNodeHashes(username, groupId)
	const knownPeers = collectKnownPeerNodeHashes(fedState, selfNodeHash, rosterNodeHashes)
	const { suspected, shunnedBy } = evaluateShunConsensusPure(knownPeers, prev.shunsByNode)
	if (!suspected) {
		if (prev.suspectedRemoved)
			return saveGroupShunState(username, groupId, {
				suspectedRemoved: false,
				suspectedAt: null,
				bannerDismissed: false,
			})
		return prev
	}
	if (prev.suspectedRemoved) return prev
	return saveGroupShunState(username, groupId, {
		suspectedRemoved: true,
		suspectedAt: Date.now(),
		shunnedBy,
	})
}

/**
 * 记录入站 shun 并评估共识（联邦 handler 入口）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} fromNodeHash 发送方 nodeHash
 * @param {string} reason 闭门羹原因
 * @returns {Promise<void>}
 */
export async function handleInboundFedShun(username, groupId, fromNodeHash, reason) {
	const shunState = await recordInboundShun(username, groupId, fromNodeHash, reason)
	await evaluateShunConsensus(username, groupId, { shunState })
}

/**
 * catchup 收尾：按需向全员探测“是否仍被招待”，再评估共识。
 * 探测仅在“窗口内已有新鲜 shun 待确认”或“冷却安全网到期”时触发，与 catchup 频率解耦，
 * 健康成员平时既不广播探测、也不做物化（evaluateShunConsensus 自会短路）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} slot FederationSlot
 * @param {{ waitMs?: number }} [opts] 探测等待 shun 入站的时间
 * @returns {Promise<ReturnType<typeof loadGroupShunState>>} 更新后状态
 */
export async function maybeProbeAndEvaluateShunConsensus(username, groupId, slot, opts = {}) {
	let shunState = await loadGroupShunState(username, groupId)
	const now = Date.now()
	const shouldProbe = !!slot?.send
		&& !shunState.suspectedRemoved
		&& (hasFreshShun(shunState.shunsByNode, now) || now - shunState.lastProbeAt >= SHUN_PROBE_COOLDOWN_MS)
	if (shouldProbe) {
		shunState = await saveGroupShunState(username, groupId, { lastProbeAt: now })
		await probeShunFromFederationPeers(username, groupId, slot, opts)
		shunState = await loadGroupShunState(username, groupId)
	}
	return evaluateShunConsensus(username, groupId, { shunState })
}

/**
 * @param {number} ms 毫秒
 * @returns {Promise<void>}
 */
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms) })

/**
 * 向联邦邻居发送带 attestation 的 join-snapshot 探测以触发 fed_shun（不应用应答）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} slot FederationSlot
 * @param {{ waitMs?: number }} [opts] 等待 shun 入站的时间
 * @returns {Promise<void>}
 */
export async function probeShunFromFederationPeers(username, groupId, slot, opts = {}) {
	if (!slot?.send) return
	const waitMs = clampNumber(opts.waitMs, 200, 8000, 1800)
	const { readJsonl } = requireDagDeps()
	const nodeHash = federationNodeHash(username)
	const localArchive = await loadLocalFederationArchive(username, groupId, readJsonl)
	const roster = slot.getRoster()
	const requestId = randomUUID()
	const attestation = await signPullAttestation(username, groupId, { requestId })
	const request = {
		requestId,
		requesterNodeHash: nodeHash,
		requesterPubKeyHash: attestation.requesterPubKeyHash,
		groupId,
		tipsHash: localArchive.summary?.tipsHash || '',
		attestation,
	}
	const peerIds = roster.map(peer => peer?.peerId).filter(Boolean)
	if (peerIds.length) 
		for (const peerId of peerIds)
			slot.send('fed_join_snapshot_request', request, peerId)
	
	await sleep(waitMs)
}
