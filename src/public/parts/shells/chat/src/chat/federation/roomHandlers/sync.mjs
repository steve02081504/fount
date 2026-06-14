import { computeDagTipIdsFromEvents } from '../../../../../../../../scripts/p2p/governance_branch.mjs'
import { bumpReputationOnRelay, recordGossipAllUnknownWant } from '../../../../../../../../scripts/p2p/reputation_user.mjs'
import { wireAction } from '../../../../../../../../scripts/p2p/trystero_wire_action.mjs'
import { takeIncomingWantIdsSlot } from '../../../../../../../../scripts/p2p/want_ids.mjs'
import { extractInboundSignedEvent } from '../../../../../../../../scripts/p2p/wire_ingress.mjs'
import { sanitizeFederatedEvent } from '../../events/wire.mjs'
import { pickFederationTargetPeerIds } from '../../governance/peerPool.mjs'
import { evaluateArchiveHandshake, loadLocalFederationArchive, wireArchiveSummary } from '../archiveHandshake.mjs'
import { handleChannelHistoryResponse } from '../channelHistory.mjs'
import { loadFederationMaterializedState, requireDagDeps } from '../deps.mjs'
import {
	buildGossipForwardPlan,
	enqueueGossipForward,
	handleGossipResponse,
	takeGossipRequestSlot,
	wantIdsLimitsFromSettings,
} from '../gossip.mjs'
import { resolveMemberEdPubKeyHex, validatePullAttestationForGroup } from '../pullAttestation.mjs'
import { buildPullResponseEnvelope } from '../pullEnvelope.mjs'
import { getPendingTipExchange } from '../registry.mjs'
import {
	hasSeenFederationEvent,
	ingestRemoteTipsForExchange,
	markSeenFederationEvent,
} from '../seen.mjs'
import { handleIncomingFedVolatile } from '../volatile.mjs'
import { parseChannelHistoryWant, parseFedTipPing, parseFedTipPong, parseGossipRequest } from '../wireSchemas.mjs'

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

	const dag = wireAction(roomContext, 'dag_event')
	dag.on((data, peerId) => {
		void (async () => {
			const signedEvent = extractInboundSignedEvent(data, groupId)
			if (!signedEvent) return
			const eventId = signedEvent.id
			if (hasSeenFederationEvent(username, groupId, eventId)) return
			const { ingestRemoteEvent } = requireDagDeps()
			const result = await ingestRemoteEvent(username, groupId, signedEvent)
			if (result === 'ok') {
				markSeenFederationEvent(username, groupId, eventId)
				const remoteNodeHash = peerToNode.get(peerId)
				if (remoteNodeHash)
					await bumpReputationOnRelay(username, remoteNodeHash, `dag:${eventId}`)
			}
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
						try { dag.send(sanitizeFederatedEvent(event), peerId) }
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

	fedVolatile.on((data, peerId) => {
		void handleIncomingFedVolatile(username, groupId, data, peerId, peerToNode, isBlockedPeer)
			.catch(error => console.error('federation: fed_volatile failed', error))
	})

	fedTipPing.on((data, peerId) => {
		void (async () => {
			const tipPing = parseFedTipPing(data)
			if (!tipPing) return
			const remoteNodeHash = peerToNode.get(peerId) || tipPing.nodeHash
			if (isBlockedPeer(remoteNodeHash)) return
			ingestRemoteTipsForExchange(username, groupId, tipPing.tips)
			const { readJsonl } = requireDagDeps()
			const localArchive = await loadLocalFederationArchive(username, groupId, readJsonl)
			const pong = {
				nodeHash,
				tips: computeDagTipIdsFromEvents(localArchive.events),
				archiveSummary: wireArchiveSummary(localArchive.summary),
			}
			fedOut.enqueue(3, () => {
				try { fedTipPong.send(pong, peerId) }
				catch (error) { console.error('federation: fed_tip_pong failed', error) }
			})
		})().catch(error => console.error('federation: fed_tip_ping failed', error))
	})

	fedTipPong.on(data => {
		const tipPong = parseFedTipPong(data)
		if (!tipPong) return
		ingestRemoteTipsForExchange(username, groupId, tipPong.tips)
		const pending = getPendingTipExchange(username, groupId)
		if (pending && tipPong.archiveSummary)
			pending.remoteSummaries.push(tipPong.archiveSummary)
	})

	gossipRequest.on((data, peerId) => {
		void (async () => {
			const parsed = parseGossipRequest(data)
			if (!parsed) return
			const { wantIds, requesterNodeHash, archiveSummary, attestation } = parsed
			const { readJsonl } = requireDagDeps()
			if (requesterNodeHash === nodeHash) return
			if (isBlockedPeer(attestation.requesterPubKeyHash)) return
			const fedState = await loadFederationMaterializedState(username, groupId)
			if (!fedState || !await validatePullAttestationForGroup(fedState, groupId, attestation)) return
			const recipientEdPubKeyHex = resolveMemberEdPubKeyHex(fedState, attestation.requesterPubKeyHash)
			if (!recipientEdPubKeyHex) return
			const dedupeKey = `${username}:${groupId}:${requesterNodeHash}:${wantIds.slice().sort().join(',')}:${parsed.ttl}`
			if (!takeGossipRequestSlot(dedupeKey)) return
			if (!takeIncomingWantIdsSlot(
				username,
				groupId,
				requesterNodeHash,
				wantIdsLimitsFromSettings(groupSettings),
			)) return

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
			if (allUnknown && localEvents.length > 0 && handshake.strictAligned)
				void recordGossipAllUnknownWant(username, groupId, requesterNodeHash).catch(console.error)

			const events = wantIds.map(id => byId.get(id)).filter(Boolean)
			if (peerId && events.length) {
				const envelope = await buildPullResponseEnvelope(username, groupId, {
					requestId: '',
					requesterNodeHash,
					requesterPubKeyHash: attestation.requesterPubKeyHash,
					recipientEdPubKeyHex,
					events,
					checkpoint: localArchive.checkpoint,
				})
				fedOut.enqueue(2, () => {
					try { gossipResponse.send(envelope, peerId) }
					catch (error) { console.error('federation: gossip_response failed', error) }
				})
				void bumpReputationOnRelay(username, requesterNodeHash, `gossip:${dedupeKey}`)
					.catch(error => console.warn('federation: gossip reputation update failed', error))
			}

			const forwardPlan = buildGossipForwardPlan(parsed, groupSettings)
			if (forwardPlan) {
				const roster = [...peerToNode.entries()].map(([pid, remoteNodeHash]) => ({ peerId: pid, remoteNodeHash }))
				const forwardPeers = await pickFederationTargetPeerIds(username, groupId, roster, groupSettings, nodeHash)
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
			if (isBlockedPeer(attestation.requesterPubKeyHash)) return
			const fedState = await loadFederationMaterializedState(username, groupId)
			if (!fedState || !await validatePullAttestationForGroup(fedState, groupId, attestation)) return
			if (!resolveMemberEdPubKeyHex(fedState, attestation.requesterPubKeyHash)) return
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
