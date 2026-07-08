/**
 * 【文件】federation/gossip.mjs
 * 【职责】联邦 gossip 协议：发起 wantIds 请求、处理 gossip_response、去重转发、等待补洞完成，并校验远端 checkpoint。
 * 【原理】requestMissingEventsGossip 先读本地，缺失则经 room.sendGossipRequest 带 archiveSummary、attestation 与 ttl；邻居在 room 内 HPKE 应答或继续转发（ttl 递减）。handleGossipResponse 仅接受 requesterNodeHash=本 nodeHash 的 HPKE envelope，applyPullInner 后 notifyGossipWaiters。入站请求侧 dedupe 与 want_ids 限速在 room 与 scripts/p2p/want_ids 协作。
 * 【数据结构】请求 { wantIds, ttl, requesterNodeHash, archiveSummary, attestation }；响应 HPKE envelope；pendingGossipRequests 按排序后的 wantIds 键等待。
 * 【关联】room.mjs、archiveHandshake.mjs、registry.mjs、peerPool.mjs、checkpointVerifier.mjs、index catchUpGroupFromPeers。
 */
import { randomUUID } from 'node:crypto'

import { createDedupeSlot } from '../../../../../../../scripts/p2p/dedupe_slot.mjs'
import { isHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { pickFederationTargetPeerIds, resolveFederationPoolLimits } from '../../../../../../../scripts/p2p/peer_pool.mjs'
import { parsePullResponseEnvelope } from '../../../../../../../scripts/p2p/schemas/federation_pull_wire.mjs'
import {
	batchWantIds,
	takeOutgoingWantIdsSlot,
} from '../../../../../../../scripts/p2p/want_ids.mjs'
import { extractInboundSignedEvent } from '../../../../../../../scripts/p2p/wire_ingress.mjs'
import {
	finishMultiWireWaiters,
	notifyMultiWireWaitersByPrefix,
	registerMultiWireWait,
} from '../../../../../../../scripts/p2p/wire_wait.mjs'
import { eventsPath } from '../lib/paths.mjs'

import { loadLocalFederationArchive, wireArchiveSummary } from './archiveHandshake.mjs'
import { loadFederationGroupSettings, localNodeHash, requireDagDeps } from './dagDependencies.mjs'
import { signPullAttestation } from './pullAttestation.mjs'
import {
	applyPullInner,
	unwrapPullEnvelopeForLocalMember,
} from './pullEnvelope.mjs'
import { gossipWaitPrefix, pendingGossipRequests } from './registry.mjs'

// gossip_request 去重窗口：仅用于合并极短时间内的重复请求 / 抑制多跳转发风暴，绝不能长于一个补齐重试周期，
// 否则——当 gossip_response 在抖动的 WebRTC 链路上丢失时——请求方的合法重试会被持续 dedupe_skip 整整一个窗口，
// 导致特定缺失事件在该窗口内永远无法被重新 serve（实测：30s 窗口下 reputation_slash/owner-succession 跨节点补齐长期失败）。
// 取值 ≈ GOSSIP_RESPONSE_WAIT_MS：既能合并 ~亚秒级突发（serve 速率 ~20/min，稳居入站限速 32/min 之下），
// 又能让每个等待周期后的重试被重新 serve，从而在任一“连通窗口”内让请求/响应成对落地、完成补齐。
const GOSSIP_RESPONSE_WAIT_MS = 3000
const takeGossipRequestDedupeSlot = createDedupeSlot({ maxSize: 2000, ttlMs: GOSSIP_RESPONSE_WAIT_MS })

/**
 * 从群设置推导 wantIds 限速参数。
 * @param {object} groupSettings 群设置
 * @returns {object} 传入 want_ids 模块的 limits
 */
export function wantIdsLimitsFromSettings(groupSettings) {
	const budget = Number(groupSettings?.wantIdsBudget)
	if (!Number.isFinite(budget)) return {}
	const batch = Math.max(4, Math.min(128, budget))
	return { inMaxBatch: batch, outMaxBatch: batch }
}

/**
 * @param {string} dedupeKey 去重键
 * @returns {boolean} 首次处理为 true
 */
export function takeGossipRequestSlot(dedupeKey) {
	return takeGossipRequestDedupeSlot(dedupeKey)
}

/**
 * 构造 gossip 中继转发载荷。
 * @param {object} parsed parseGossipRequest 结果
 * @param {object} groupSettings 群设置
 * @returns {{ forwardPayload: object, forwardTtl: number } | null} 可转发时返回载荷与 ttl
 */
export function buildGossipForwardPlan(parsed, groupSettings) {
	const { wantIds, ttl, requesterNodeHash, archiveSummary, attestation } = parsed
	const { gossipTtl: maxTtl } = resolveFederationPoolLimits(groupSettings)
	const forwardTtl = Math.min(ttl, maxTtl)
	if (forwardTtl <= 0) return null
	return {
		forwardPayload: {
			wantIds,
			ttl: forwardTtl - 1,
			requesterNodeHash,
			archiveSummary,
			attestation,
		},
		forwardTtl,
	}
}

/**
 * 将 gossip_request 入队转发到目标 peer（或广播）。
 * @param {object} fedOut 出站队列
 * @param {{ send: Function }} gossipRequest gossip_request send
 * @param {object} forwardPayload 转发载荷
 * @param {string[]} forwardPeers 目标 peerId 列表
 * @returns {void}
 */
export function enqueueGossipForward(fedOut, gossipRequest, forwardPayload, forwardPeers) {
	fedOut.enqueue(1, () => {
		try {
			if (forwardPeers.length)
				for (const forwardPeerId of forwardPeers)
					gossipRequest.send(forwardPayload, forwardPeerId)
			else
				gossipRequest.send(forwardPayload, null)
		}
		catch (error) {
			console.error('federation: gossip_request forward failed', error)
		}
	})
}

/**
 * @param {string[]} wantIds 缺失事件 ID 列表
 * @returns {string} 等待表后缀键
 */
function gossipWaitSuffix(wantIds) {
	return [...wantIds].sort().join(',')
}

/**
 * 注册 gossip 响应等待（最长 `GOSSIP_RESPONSE_WAIT_MS`）。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {string[]} wantIds 请求的缺失 ID 列表
 * @returns {Promise<void>}
 */
function waitForGossipProgress(username, groupId, wantIds) {
	return registerMultiWireWait(
		pendingGossipRequests,
		gossipWaitPrefix(username, groupId),
		gossipWaitSuffix(wantIds),
		GOSSIP_RESPONSE_WAIT_MS,
		() => {},
	)
}

/**
 * 立即结束某次 gossip 等待。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {string[]} wantIds 与注册时相同的缺失 ID 列表
 * @returns {void}
 */
export function forceResolveGossipWait(username, groupId, wantIds) {
	finishMultiWireWaiters(
		pendingGossipRequests,
		gossipWaitPrefix(username, groupId),
		gossipWaitSuffix(wantIds),
	)
}

/**
 * 收到 gossip 响应后唤醒等待方。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {ReadonlySet<string>} receivedIds 本批响应中的事件 ID
 * @returns {void}
 */
export function notifyGossipWaiters(username, groupId, receivedIds) {
	notifyMultiWireWaitersByPrefix(
		pendingGossipRequests,
		gossipWaitPrefix(username, groupId),
		receivedIds,
		suffix => suffix.split(','),
	)
}

/**
 * 处理入站 `gossip_response` 并唤醒等待方。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {unknown} data `gossip_response` 载荷
 * @returns {Promise<void>}
 */
export async function handleGossipResponse(username, groupId, data) {
	const nodeHash = localNodeHash()
	const envelope = parsePullResponseEnvelope(data)
	if (!envelope) return
	if (envelope.requesterNodeHash !== nodeHash) return

	const inner = await unwrapPullEnvelopeForLocalMember(username, groupId, envelope)
	if (!inner) return

	const receivedIds = new Set()
	if (Array.isArray(inner.events))
		for (const rawEvent of inner.events) {
			const signedEvent = extractInboundSignedEvent(rawEvent, groupId)
			if (signedEvent?.id) receivedIds.add(signedEvent.id)
		}

	await applyPullInner(username, groupId, inner, { allowCheckpoint: false })
	notifyGossipWaiters(username, groupId, receivedIds)
}

/**
 * 按 ID 查询本地事件，可选经联邦 gossip 补洞。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {{ wantIds?: string[], awaitGossip?: boolean }} [query] 查询选项
 * @returns {Promise<{ found: boolean, events: object[], stillMissing: string[], rateLimited: boolean }>} 补洞结果
 */
export async function requestMissingEventsGossip(username, groupId, query = {}) {
	const { readJsonl } = requireDagDeps()
	const nodeHash = localNodeHash()
	const wantIds = [...new Set((query.wantIds || []).filter(isHex64))]

	/**
	 *
	 */
	/** @returns {Promise<{ filled: object[], stillMissing: string[] }>} 本地已命中与仍缺 id */
	const readFilled = async () => {
		const eventsById = new Map((await readJsonl(eventsPath(username, groupId))).map(event => [event.id, event]))
		return {
			filled: wantIds.map(id => eventsById.get(id)).filter(Boolean),
			stillMissing: wantIds.filter(id => !eventsById.has(id)),
		}
	}

	let { filled, stillMissing } = await readFilled()
	let rateLimited = false

	if (stillMissing.length && query.awaitGossip !== false) {
		const waitPromise = waitForGossipProgress(username, groupId, stillMissing)
		const { ensureFederationRoom } = await import('./room.mjs')
		const slot = await ensureFederationRoom(username, groupId)
		if (!slot?.send)
			forceResolveGossipWait(username, groupId, stillMissing)
		else {
			const groupSettings = await loadFederationGroupSettings(username, groupId)
			if (!takeOutgoingWantIdsSlot( groupId, wantIdsLimitsFromSettings(groupSettings))) {
				rateLimited = true
				forceResolveGossipWait(username, groupId, stillMissing)
			}
			else {
				const localArchive = await loadLocalFederationArchive(username, groupId, readJsonl)
				const { gossipTtl, wantIdsBudget } = resolveFederationPoolLimits(groupSettings)
				const targets = await pickFederationTargetPeerIds(groupId,
					slot.getRoster(),
					groupSettings,
					nodeHash,
				)
				try {
					const requestId = randomUUID()
					const batchedWantIds = batchWantIds(stillMissing, wantIdsBudget)
					const attestation = await signPullAttestation(username, groupId, { requestId, wantIds: batchedWantIds })
					const payload = {
						wantIds: batchedWantIds,
						ttl: gossipTtl,
						requesterNodeHash: nodeHash,
						archiveSummary: wireArchiveSummary(localArchive.summary),
						attestation,
					}
					if (targets.length)
						for (const peerId of targets)
							slot.send('gossip_request', payload, peerId)
					else
						slot.send('gossip_request', payload, null)
				}
				catch (error) {
					console.error('federation: gossip_request failed', error)
					forceResolveGossipWait(username, groupId, stillMissing)
				}
				await waitPromise.catch(console.error)
			}
		}
		({ filled, stillMissing } = await readFilled())
	}

	return {
		found: !wantIds.length || !stillMissing.length,
		events: filled,
		stillMissing,
		rateLimited,
	}
}
