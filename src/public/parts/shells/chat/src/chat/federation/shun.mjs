/**
 * 联邦闭门羹 fed_shun：拒绝服务时不泄露群内容，仅告知请求方“不伺候你”。
 */
import { randomUUID } from 'node:crypto'

import { clampNumber } from '../../../../../../../scripts/clamp.mjs'
import { createDedupeSlot } from '../../../../../../../scripts/p2p/dedupe_slot.mjs'
import { computeDagTipIdsFromEvents } from '../../../../../../../scripts/p2p/governance_branch.mjs'
import { isHex64, normalizeHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { sleep } from '../../../../../../../scripts/sleep.mjs'
import { loadGroupShunState, saveGroupShunState, SHUN_CONSENSUS_WINDOW_MS, updateGroupShunState } from '../../group/groupShunState.mjs'
import { resolveTargetMemberKey } from '../dag/reducers/helpers.mjs'

import { loadLocalFederationArchive, wireArchiveSummary } from './archiveHandshake.mjs'
import { localNodeHash, loadFederationMaterializedState, requireDagDeps } from './dagDependencies.mjs'
import { signPullAttestation } from './pullAttestation.mjs'

/** 出站 fed_shun 限流：同群同请求方 30s 内至多一发。 */
const OUTBOUND_SHUN_DEDUPE_MS = 30_000
const takeOutboundShunSlot = createDedupeSlot({ maxSize: 4000, ttlMs: OUTBOUND_SHUN_DEDUPE_MS })

/**
 * 主动探测的冷却安全网：尚无任何新鲜 shun 信号时，最多每此间隔向全员探测一次。
 * 与共识窗口解耦——窗口内的 shun 始终计入，但冷启动探测需更频繁，
 * 否则一次探测因 P2P 尚未连通而落空后，被移除方要等满共识窗口才会重试，迟迟无法自判出局。
 * 略长于出站 dedupe TTL，降低探测撞上对端 shun 静默窗的概率。
 */
const SHUN_PROBE_COOLDOWN_MS = OUTBOUND_SHUN_DEDUPE_MS + 5_000
const SHUN_PROBE_ROSTER_WAIT_MS = 12_000
const SHUN_PROBE_ROSTER_POLL_MS = 400
const SHUN_PROBE_INBOUND_SETTLE_MS = 800

/**
 * 探测前等待联邦 roster 出现邻居（P2P 会合未完成时 probe 会落空）。
 * @param {object | null | undefined} slot FederationSlot
 * @param {number} [maxWaitMs] 等待上限
 * @returns {Promise<boolean>} roster 非空
 */
async function waitForRosterPeers(slot, maxWaitMs = SHUN_PROBE_ROSTER_WAIT_MS) {
	if (!slot?.getRoster) return false
	const deadline = Date.now() + maxWaitMs
	while (Date.now() < deadline) {
		if (slot.getRoster().length > 0) return true
		await sleep(SHUN_PROBE_ROSTER_POLL_MS)
	}
	return slot.getRoster().length > 0
}

/**
 * 共识判定的已知对端 nodeHash：优先信令房 roster（除己），无 roster 时回落物化 active 成员的 homeNodeHash。
 * @param {object | null | undefined} state 物化群状态
 * @param {string} selfNodeHash 本机 nodeHash
 * @param {string[] | null | undefined} [rosterNodeHashes] 联邦房内可见 nodeHash
 * @returns {string[]} 去重 nodeHash 列表
 */
export function collectKnownPeerNodeHashes(state, selfNodeHash, rosterNodeHashes = null) {
	const self = normalizeHex64(selfNodeHash) || ''
	const fromMembers = new Set()
	for (const member of Object.values(state?.members || {})) {
		if (member?.status !== 'active') continue
		const home = normalizeHex64(member.homeNodeHash)
		if (isHex64(home) && home !== self) fromMembers.add(home)
	}
	if (!rosterNodeHashes?.length) return [...fromMembers]
	const fromRoster = [...new Set(
		rosterNodeHashes.map(id => normalizeHex64(id)).filter(isHex64),
	)].filter(h => h !== self)
	return fromRoster.length ? fromRoster : [...fromMembers]
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
	if (fedState?.bannedMembers?.has?.(pk)) return { shun: true, reason: 'not_a_member' }
	const member = fedState?.members?.[pk]
	// 已知成员但非 active（被移除）→ 闭门羹。但“从未见过该 pubKey”不等于“已出局”：入群 bootstrap 期
	// 新成员的 member_join 尚未物化到本端时，若对未知 pubKey 回 fed_shun('not_a_member')，会让新成员因“对端
	// 还不认识我”被 shun 共识误判出局（suspectedRemoved 自锁 5 分钟）。故未知 pubKey 一律放行不 shun，与
	// resolveShunForNodeHashRequester 对未匹配节点的放行语义保持一致；真正的非成员由后续 attestation 校验静默拦截。
	if (member && member.status !== 'active') return { shun: true, reason: 'not_a_member' }
	return { shun: false, reason: null }
}

/**
 * 按请求方 homeNodeHash 判断是否应回闭门羹（tip ping 等仅带 nodeHash 的帧）。
 * @param {object | null | undefined} fedState 物化群状态
 * @param {(subject: string) => boolean} isBlockedPeer 拉黑检查
 * @param {string} requesterNodeHash 请求方 nodeHash
 * @returns {{ shun: boolean, reason: 'not_a_member' | 'blocked' | null }} 是否应回闭门羹
 */
export function resolveShunForNodeHashRequester(fedState, isBlockedPeer, requesterNodeHash) {
	const node = normalizeHex64(requesterNodeHash)
	if (!node) return { shun: false, reason: null }
	if (isBlockedPeer(node)) return { shun: true, reason: 'blocked' }
	if (fedState?.bannedNodes?.has?.(node)) return { shun: true, reason: 'not_a_member' }
	let matched = false
	for (const member of Object.values(fedState?.members || {})) {
		if (normalizeHex64(member?.homeNodeHash) !== node) continue
		matched = true
		if (member.status === 'active') return { shun: false, reason: null }
	}
	return matched ? { shun: true, reason: 'not_a_member' } : { shun: false, reason: null }
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
 * member_ban 落盘后向被封成员 home 节点主动推送 fed_shun（不等待对端探测）。
 * @param {string} username  replica 用户
 * @param {string} groupId 群 ID
 * @param {string | null | undefined} targetHomeNodeHash 目标 homeNodeHash
 * @param {'not_a_member' | 'blocked'} [reason] 原因
 * @returns {Promise<void>}
 */
export async function pushFedShunToHomeNode(username, groupId, targetHomeNodeHash, reason = 'not_a_member') {
	const home = normalizeHex64(targetHomeNodeHash)
	if (!isHex64(home)) return
	const { getFederationPartitionSlot } = await import('./registry.mjs')
	const { LOGIC_SYNC_PARTITION } = await import('./partitions.mjs')
	const slot = getFederationPartitionSlot(username, groupId, LOGIC_SYNC_PARTITION)
	if (!slot?.sendToPeer || !slot.fedOut) return
	const peerId = slot.getPeerIdByNodeHash?.(home)
		|| slot.getRoster().find(peer => normalizeHex64(peer?.remoteNodeHash) === home)?.peerId
	if (!peerId) return
	sendFedShun(
		slot.fedOut,
		(payload, targetPeerId) => slot.sendToPeer(targetPeerId, 'fed_shun', payload),
		groupId,
		localNodeHash(),
		home,
		peerId,
		reason,
	)
}

/**
 * member_ban 事件 hook：向被封成员的 home 节点推送 fed_shun。
 * @param {string} username replica 用户
 * @param {string} groupId 群 ID
 * @param {object} banEvent member_ban 事件
 * @returns {Promise<void>}
 */
export async function notifyFedShunAfterMemberBan(username, groupId, banEvent) {
	const targetKey = resolveTargetMemberKey(banEvent?.content)
	if (!targetKey) return
	const state = await loadFederationMaterializedState(username, groupId)
	await pushFedShunToHomeNode(username, groupId, state?.members?.[targetKey]?.homeNodeHash)
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
 * 从 FederationSlot roster 提取对端 nodeHash（与 peerToNode / shunsByNode 键一致）。
 * @param {object | null | undefined} slot FederationSlot
 * @returns {string[] | null} nodeHash 列表；slot 不可用时 null
 */
export function rosterNodeHashesFromSlot(slot) {
	if (!slot?.getRoster) return null
	return slot.getRoster().map(peer => normalizeHex64(peer?.remoteNodeHash)).filter(isHex64)
}

/**
 * 读取联邦同步房名册中可见对端的 nodeHash（联邦房不可用或未 init P2P 时返回 null）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {Promise<string[] | null>} nodeHash 列表或 null
 */
async function loadRosterNodeHashes(username, groupId) {
	const { isNodeInitialized } = await import('../../../../../../../scripts/p2p/node/instance.mjs')
	if (!isNodeInitialized()) return null
	const { getFederationPartitionSlot } = await import('./registry.mjs')
	const { LOGIC_SYNC_PARTITION } = await import('./partitions.mjs')
	const slot = getFederationPartitionSlot(username, groupId, LOGIC_SYNC_PARTITION)
	return slot ? rosterNodeHashesFromSlot(slot) : null
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
 * @param {{ shunState?: Awaited<ReturnType<typeof loadGroupShunState>>, rosterNodeHashes?: string[] | null }} [opts] 复用 shun 状态 / catchup 期 roster 快照
 * @returns {Promise<ReturnType<typeof loadGroupShunState>>} 更新后状态
 */
export async function evaluateShunConsensus(username, groupId, opts = {}) {
	const prev = opts.shunState ?? await loadGroupShunState(username, groupId)
	// 从未收到任何 shun 且当前未疑似出局：无可评估，跳过物化与名册读取。
	if (!prev.suspectedRemoved && !Object.keys(prev.shunsByNode).length) return prev
	const selfNodeHash = localNodeHash()
	const fedState = await loadFederationMaterializedState(username, groupId)
	const rosterNodeHashes = opts.rosterNodeHashes !== undefined
		? opts.rosterNodeHashes
		: await loadRosterNodeHashes(username, groupId)
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
	const rosterNodeHashes = await loadRosterNodeHashes(username, groupId)
	await evaluateShunConsensus(username, groupId, { shunState, rosterNodeHashes })
}

/**
 * catchup 收尾：按需向全员探测“是否仍被招待”，再评估共识。
 * 尚无 shun 时每轮 catchup 均可重探（P2P 会合前单次落空很常见）；有 shun 后按新鲜度/冷却节流。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} slot FederationSlot
 * @param {{ waitMs?: number }} [opts] 探测等待 shun 入站的时间
 * @returns {Promise<ReturnType<typeof loadGroupShunState>>} 更新后状态
 */
export async function maybeProbeAndEvaluateShunConsensus(username, groupId, slot, opts = {}) {
	let shunState = await loadGroupShunState(username, groupId)
	const now = Date.now()
	const noShunsYet = !Object.keys(shunState.shunsByNode).length
	const shouldProbe = !!slot?.send
		&& !shunState.suspectedRemoved
		&& (noShunsYet || hasFreshShun(shunState.shunsByNode, now) || now - shunState.lastProbeAt >= SHUN_PROBE_COOLDOWN_MS)
	let rosterSnapshot = rosterNodeHashesFromSlot(slot)
	if (shouldProbe) {
		await waitForRosterPeers(slot, Math.min(SHUN_PROBE_ROSTER_WAIT_MS, clampNumber(opts.waitMs ?? 1800, 200, 15_000)))
		shunState = await saveGroupShunState(username, groupId, { lastProbeAt: now })
		await probeShunViaTipPingToRosterPeers(username, groupId, slot)
		await probeShunFromFederationPeers(username, groupId, slot, opts)
		await sleep(SHUN_PROBE_INBOUND_SETTLE_MS)
		shunState = await loadGroupShunState(username, groupId)
		rosterSnapshot = rosterNodeHashesFromSlot(slot)
	}
	return evaluateShunConsensus(username, groupId, { shunState, rosterNodeHashes: rosterSnapshot })
}

/**
 * 向 roster 全员发 fed_tip_ping 触发 fed_shun（稀疏 peer pool 可能漏选，shun 探测必须全覆盖）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} slot FederationSlot
 * @returns {Promise<void>}
 */
export async function probeShunViaTipPingToRosterPeers(username, groupId, slot) {
	if (!slot?.send) return
	const { readJsonl } = requireDagDeps()
	const nodeHash = localNodeHash()
	const localArchive = await loadLocalFederationArchive(username, groupId, readJsonl)
	const ping = {
		nodeHash,
		tips: computeDagTipIdsFromEvents(localArchive.events),
		archiveSummary: wireArchiveSummary(localArchive.summary),
	}
	const peerIds = slot.getRoster().map(peer => peer?.peerId).filter(Boolean)
	if (peerIds.length)
		for (const peerId of peerIds)
			slot.send('fed_tip_ping', ping, peerId)
	else
		slot.send('fed_tip_ping', ping, null)
}

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
	const waitMs = clampNumber(opts.waitMs ?? 1800, 200, 15_000)
	const { readJsonl } = requireDagDeps()
	const nodeHash = localNodeHash()
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
