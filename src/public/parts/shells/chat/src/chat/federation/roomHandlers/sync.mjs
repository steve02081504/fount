import { stripDagEventLocalExtensions } from '../../../../../../../../scripts/p2p/dag/strip_extensions.mjs'
import { computeDagTipIdsFromEvents } from '../../../../../../../../scripts/p2p/governance_branch.mjs'
import { isHex64 } from '../../../../../../../../scripts/p2p/hexIds.mjs'
import { widenExploreFromTrustedAnchors } from '../../../../../../../../scripts/p2p/network.mjs'
import { pickFederationTargetPeerIds } from '../../../../../../../../scripts/p2p/peer_pool.mjs'
import { bumpReputationOnRelay, recordGossipAllUnknownWant } from '../../../../../../../../scripts/p2p/reputation.mjs'
import { wireAction } from '../../../../../../../../scripts/p2p/trystero_wire_action.mjs'
import { takeIncomingWantIdsSlot } from '../../../../../../../../scripts/p2p/want_ids.mjs'
import { extractInboundSignedEvent } from '../../../../../../../../scripts/p2p/wire_ingress.mjs'
import { evaluateArchiveHandshake, loadLocalFederationArchive, wireArchiveSummary } from '../archiveHandshake.mjs'
import { scheduleCatchUp } from '../catchUpScheduler.mjs'
import { handleChannelHistoryResponse } from '../channelHistory.mjs'
import { loadFederationMaterializedState, requireDagDeps } from '../deps.mjs'
import {
	buildGossipForwardPlan,
	enqueueGossipForward,
	handleGossipResponse,
	takeGossipRequestSlot,
	wantIdsLimitsFromSettings,
} from '../gossip.mjs'
import { resolveMemberEdPubKeyHex, validatePullAttestationForGroup, verifyPullAttestationSignatureForMember } from '../pullAttestation.mjs'
import { buildPullResponseEnvelope } from '../pullEnvelope.mjs'
import { getPendingTipExchange } from '../registry.mjs'
import {
	hasSeenFederationEvent,
	ingestRemoteTipsForExchange,
	tryMarkSeenFederationEvent,
} from '../seen.mjs'
import { handleInboundFedShun, resolveShunForNodeHashRequester, resolveShunForPubKeyRequester, sendFedShun } from '../shun.mjs'
import { handleIncomingFedVolatile } from '../volatile.mjs'
import { parseChannelHistoryWant, parseFedShun, parseFedTipPing, parseFedTipPong, parseGossipRequest } from '../wireSchemas.mjs'

/**
 * DAG / gossip / 频道历史 / volatile / tip exchange handler。
 * @param {import('./roomContext.mjs').FederationSyncContext} roomContext 房间上下文
 * @returns {void}
 */
export function registerSyncHandlers(roomContext) {
	const {
		username,
		groupId,
		nodeHash,
		groupSettings,
		room,
		fedOut,
		peerToNode,
		isBlockedPeer,
	} = roomContext

	// 方案3（dag_event 高频路径）：远端引用的父 id 中存在本地从未见过的事件 ⇒ 本地落后，需调度补齐。
	// 用进程级 seen LRU（已由本地 events 预热 + 入站 ingest 维护）做廉价对比，避免每条 live 帧读盘。
	/**
	 * @param {unknown} tips 远端 DAG 叶 / 父 id 列表
	 * @returns {boolean} 是否暴露本地缺口
	 */
	const remoteTipsRevealLocalGap = tips => {
		if (!Array.isArray(tips)) return false
		for (const tipId of tips) {
			const id = String(tipId).trim().toLowerCase()
			if (isHex64(id) && !hasSeenFederationEvent(username, groupId, id)) return true
		}
		return false
	}

	// 方案3（ping/pong 低频路径）：远端 tips 集合与本地当前 tips 集合不一致 ⇒ 任何 DAG 分歧即调度补齐，
	// 不再要求“tip 未 seen”。这能覆盖“本地已 seen 该 tip 但缺整条祖先链（有叶无链）”的死锁。
	/**
	 * @param {unknown} remoteTips 远端 DAG 叶 id 列表
	 * @param {string[]} localTips 本地 DAG 叶 id 列表
	 * @returns {boolean} 两侧 tip 集合是否存在差异
	 */
	const tipSetsDiverge = (remoteTips, localTips) => {
		if (!Array.isArray(remoteTips)) return false
		const local = new Set()
		for (const id of localTips) {
			const norm = String(id).trim().toLowerCase()
			if (isHex64(norm)) local.add(norm)
		}
		const remote = new Set()
		for (const id of remoteTips) {
			const norm = String(id).trim().toLowerCase()
			if (isHex64(norm)) remote.add(norm)
		}
		if (remote.size !== local.size) return true
		for (const id of remote)
			if (!local.has(id)) return true
		return false
	}

	const dag = wireAction(roomContext, 'dag_event')
	dag.on((data, peerId) => {
		const signedEvent = extractInboundSignedEvent(data, groupId)
		if (!signedEvent) return
		if (!tryMarkSeenFederationEvent(username, groupId, signedEvent.id)) return
		void (async () => {
			const eventId = signedEvent.id
			const { ingestRemoteEvent } = requireDagDeps()
			const result = await ingestRemoteEvent(username, groupId, signedEvent, { skipSeenDedup: true })
			if (result?.status === 'applied') {
				const remoteNodeHash = peerToNode.get(peerId)
				if (remoteNodeHash)
					await bumpReputationOnRelay( remoteNodeHash, `dag:${eventId}`)
			}
			if (result?.status === 'quarantined' || result?.status === 'pending')
				scheduleCatchUp(username, groupId)
			// live 漏帧快速补洞：该事件引用了本地缺失的父事件 ⇒ 调度有界补齐（scheduler 自带防抖/冷却/退避硬闸，dag_event 高频也不放大负载）。
			if (remoteTipsRevealLocalGap(signedEvent.prev_event_ids))
				scheduleCatchUp(username, groupId)
		})().catch(console.error)
	})

	// 新 peer 接入时推送本地 DAG 叶 + 本机 member_join：member_join 自证（开放群无需 attestation），
	// 打破“快照/gossip 均被 attestation 门控、而对端尚未知本机成员”的引导期死锁。
	room.onPeerJoin(peerId => {
		fedOut.enqueue(2, () => {
			void (async () => {
				const { readJsonl } = requireDagDeps()
				const { events } = await loadLocalFederationArchive(username, groupId, readJsonl)
				if (!events.length) return
				const flushIds = new Set(computeDagTipIdsFromEvents(events))
				for (const event of events)
					if (event.type === 'member_join' && event.node_id === nodeHash)
						flushIds.add(event.id)
				for (const event of events)
					if (flushIds.has(event.id))
						try { dag.send(stripDagEventLocalExtensions(event), peerId) }
						catch (error) { console.error('federation: bootstrap flush failed', error) }
			})().catch(console.error)
		})
	})

	const gossipRequest = wireAction(roomContext, 'gossip_request')
	const gossipResponse = wireAction(roomContext, 'gossip_response')
	const channelHistoryWant = wireAction(roomContext, 'channel_history_want')
	const channelHistoryResponse = wireAction(roomContext, 'channel_history_response')
	const fedVolatile = wireAction(roomContext, 'fed_volatile')
	const fedTipPing = wireAction(roomContext, 'fed_tip_ping')
	const fedTipPong = wireAction(roomContext, 'fed_tip_pong')
	const fedShun = wireAction(roomContext, 'fed_shun')

	/**
	 * 对带 attestation 的拉取请求方回闭门羹（若应拒绝）。
	 * @param {object | null | undefined} fedState 物化群状态
	 * @param {string} requesterPubKeyHash 请求方 pubKeyHash
	 * @param {string} requesterNodeHash 请求方 nodeHash
	 * @param {string} peerId Trystero peer
	 * @returns {boolean} 已 shun 并应中止处理
	 */
	const maybeShunPubKeyRequester = (fedState, requesterPubKeyHash, requesterNodeHash, peerId) => {
		const decision = resolveShunForPubKeyRequester(fedState, isBlockedPeer, requesterPubKeyHash)
		if (!decision.shun || !decision.reason || !peerId) return false
		sendFedShun(fedOut, fedShun.send, groupId, nodeHash, requesterNodeHash, peerId, decision.reason)
		return true
	}

	fedShun.on((data, peerId) => {
		void (async () => {
			const shun = parseFedShun(data, groupId)
			if (!shun) return
			const fromNode = peerToNode.get(peerId) || shun.nodeHash
			await handleInboundFedShun(username, groupId, fromNode, shun.reason)
		})().catch(error => console.error('federation: fed_shun failed', error))
	})

	fedVolatile.on((data, peerId) => {
		void handleIncomingFedVolatile(username, groupId, data, peerId, peerToNode, isBlockedPeer)
			.catch(error => console.error('federation: fed_volatile failed', error))
	})

	fedTipPing.on((data, peerId) => {
		void (async () => {
			const tipPing = parseFedTipPing(data)
			if (!tipPing) return
			const remoteNodeHash = peerToNode.get(peerId) || tipPing.nodeHash
			if (isBlockedPeer(remoteNodeHash)) {
				if (peerId && remoteNodeHash)
					sendFedShun(fedOut, fedShun.send, groupId, nodeHash, remoteNodeHash, peerId, 'blocked')
				return
			}
			const fedState = await loadFederationMaterializedState(username, groupId)
			if (fedState) {
				const nodeDecision = resolveShunForNodeHashRequester(fedState, isBlockedPeer, remoteNodeHash)
				if (nodeDecision.shun && nodeDecision.reason && peerId && remoteNodeHash) {
					sendFedShun(fedOut, fedShun.send, groupId, nodeHash, remoteNodeHash, peerId, nodeDecision.reason)
					return
				}
			}
			ingestRemoteTipsForExchange(username, groupId, tipPing.tips)
			const { readJsonl } = requireDagDeps()
			const localArchive = await loadLocalFederationArchive(username, groupId, readJsonl)
			const localTips = computeDagTipIdsFromEvents(localArchive.events)
			// 心跳/补洞探测照常 pong 回去；同时若远端 tips 集合与本地不一致（任何 DAG 分歧）⇒ 调度补齐。
			if (tipSetsDiverge(tipPing.tips, localTips))
				scheduleCatchUp(username, groupId)
			const pong = {
				nodeHash,
				tips: localTips,
				archiveSummary: wireArchiveSummary(localArchive.summary),
			}
			fedOut.enqueue(3, () => {
				try {
					fedTipPong.send(pong, peerId)
				}
				catch (error) { console.error('federation: fed_tip_pong failed', error) }
			})
		})().catch(error => console.error('federation: fed_tip_ping failed', error))
	})

	fedTipPong.on((data, peerId) => {
		void (async () => {
			const tipPong = parseFedTipPong(data)
			if (!tipPong) return
			ingestRemoteTipsForExchange(username, groupId, tipPong.tips)
			const pending = getPendingTipExchange(username, groupId)
			if (pending) {
				if (tipPong.archiveSummary)
					pending.remoteSummaries.push(tipPong.archiveSummary)
				pending.onResponse?.()
			}
			// 远端 pong 的 tips 集合与本地不一致（任何 DAG 分歧）⇒ 调度补齐（心跳/被动 pong 也能驱动兜底）。
			const { readJsonl } = requireDagDeps()
			const localArchive = await loadLocalFederationArchive(username, groupId, readJsonl)
			if (tipSetsDiverge(tipPong.tips, computeDagTipIdsFromEvents(localArchive.events)))
				scheduleCatchUp(username, groupId)
		})().catch(error => console.error('federation: fed_tip_pong failed', error))
	})

	gossipRequest.on((data, peerId) => {
		void (async () => {
			const parsed = parseGossipRequest(data)
			if (!parsed) return
			const { wantIds, requesterNodeHash, archiveSummary, attestation } = parsed
			const { readJsonl } = requireDagDeps()
			if (requesterNodeHash === nodeHash) return
			const fedState = await loadFederationMaterializedState(username, groupId)
			if (!fedState || !attestation) return
			if (maybeShunPubKeyRequester(fedState, attestation.requesterPubKeyHash, requesterNodeHash, peerId))
				return
			if (!await verifyPullAttestationSignatureForMember(fedState, groupId, attestation)) return
			if (!await validatePullAttestationForGroup(fedState, groupId, attestation)) return
			const recipientEdPubKeyHex = resolveMemberEdPubKeyHex(fedState, attestation.requesterPubKeyHash)
			if (!recipientEdPubKeyHex) {
				if (peerId)
					sendFedShun(fedOut, fedShun.send, groupId, nodeHash, requesterNodeHash, peerId, 'not_a_member')
				return
			}
			const dedupeKey = `${username}:${groupId}:${requesterNodeHash}:${wantIds.slice().sort().join(',')}:${parsed.ttl}`
			if (!takeGossipRequestSlot(dedupeKey)) return
			if (!takeIncomingWantIdsSlot(
				groupId,
				requesterNodeHash,
				wantIdsLimitsFromSettings(groupSettings),
			))
				return

			const localArchive = await loadLocalFederationArchive(username, groupId, readJsonl)
			const handshake = evaluateArchiveHandshake(
				archiveSummary,
				localArchive.summary,
				localArchive.events,
				wantIds,
			)
			if (!handshake.allow) return

			const localEvents = localArchive.events
			const byId = new Map(localEvents.map(event => [event.id, event]))
			const allUnknown = wantIds.length > 0 && wantIds.every(id => !byId.has(id))
			if (allUnknown && localEvents.length > 0 && handshake.strictAligned) {
				void recordGossipAllUnknownWant(groupId, requesterNodeHash).catch(console.error)
				widenExploreFromTrustedAnchors()
			}

			const events = wantIds.map(id => byId.get(id)).filter(Boolean)
			if (peerId && events.length) {
				const envelope = await buildPullResponseEnvelope(username, groupId, {
					requestId: attestation.requestId,
					requesterNodeHash,
					requesterPubKeyHash: attestation.requesterPubKeyHash,
					recipientEdPubKeyHex,
					events,
					checkpoint: localArchive.checkpoint,
				})
				fedOut.enqueue(2, () => {
					try {
						gossipResponse.send(envelope, peerId)
					}
					catch (error) { console.error('federation: gossip_response failed', error) }
				})
				void bumpReputationOnRelay( requesterNodeHash, `gossip:${dedupeKey}`)
					.catch(error => console.warn('federation: gossip reputation update failed', error))
			}

			const forwardPlan = buildGossipForwardPlan(parsed, groupSettings)
			if (forwardPlan) {
				const roster = [...peerToNode.entries()].map(([pid, remoteNodeHash]) => ({ peerId: pid, remoteNodeHash }))
				const forwardPeers = await pickFederationTargetPeerIds(groupId, roster, groupSettings, nodeHash)
				enqueueGossipForward(fedOut, gossipRequest, forwardPlan.forwardPayload, forwardPeers)
			}
		})().catch(console.error)
	})

	gossipResponse.on(data => {
		void handleGossipResponse(username, groupId, data).catch(console.error)
	})

	channelHistoryWant.on((data, peerId) => {
		void (async () => {
			const historyWant = parseChannelHistoryWant(data, nodeHash, groupId)
			if (!historyWant) return
			const { requesterNodeHash, requestId, channelId, before, limit, attestation } = historyWant
			const fedState = await loadFederationMaterializedState(username, groupId)
			if (!fedState || !attestation) return
			if (maybeShunPubKeyRequester(fedState, attestation.requesterPubKeyHash, requesterNodeHash, peerId))
				return
			if (!await verifyPullAttestationSignatureForMember(fedState, groupId, attestation)) return
			if (!await validatePullAttestationForGroup(fedState, groupId, attestation)) return
			if (!resolveMemberEdPubKeyHex(fedState, attestation.requesterPubKeyHash)) {
				if (peerId)
					sendFedShun(fedOut, fedShun.send, groupId, nodeHash, requesterNodeHash, peerId, 'not_a_member')
				return
			}
			const { listChannelMessages } = await import('../../dag/queries.mjs')
			const messages = await listChannelMessages(username, groupId, channelId, {
				before,
				limit,
				limitCap: 500,
				decrypt: false,
				includeArchive: true,
				fetchFromPeers: false,
			})
			if (!messages.length || !peerId) return
			fedOut.enqueue(2, () => {
				try {
					channelHistoryResponse.send({
						requesterNodeHash,
						requestId,
						channelId,
						messages,
					}, peerId)
				}
				catch (error) {
					console.error('federation: channel_history_response failed', error)
				}
			})
		})().catch(console.error)
	})

	channelHistoryResponse.on(data => {
		void handleChannelHistoryResponse(username, groupId, data).catch(console.error)
	})

}
