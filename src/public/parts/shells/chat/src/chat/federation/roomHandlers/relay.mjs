import { wireAction } from '../../../../../../../../scripts/p2p/room_wire_action.mjs'
import {
	parseDiscoveryAnnounce,
	parseDiscoveryQuery,
	parseDiscoveryQueryResponse,
} from '../../../../../../../../scripts/p2p/schemas/discovery_wire.mjs'
import { parseJoinSnapshotRequest, parseJoinSnapshotResponse } from '../../../../../../../../scripts/p2p/schemas/federation_pull_wire.mjs'
import { applyRemoteDigestClaim } from '../archiveDigestClaims.mjs'
import {
	handleFedArchiveMonthWant,
	noteFedArchiveMonthResponse,
} from '../archiveMonthPull.mjs'
import { parseFedArchiveMonthResponse, parseFedArchiveMonthWant } from '../archiveMonthWire.mjs'
import { parseFedBootstrapRequest, parseFedBootstrapResponse } from '../bootstrap/wire.mjs'
import {
	applyFedBootstrapResponse,
	handleFedBootstrapRequest,
} from '../bootstrapRelay.mjs'
import {
	handleDiscoveryQuery,
	ingestDiscoveryAnnounce,
} from '../discoveryRelay.mjs'
import { handleJoinSnapshotRequest } from '../joinSnapshot.mjs'
import { bindFedSender } from '../outbound.mjs'
import { noteJoinSnapshotResponse } from '../pull/joinSnapshotPick.mjs'

/**
 * bootstrap / join snapshot / discovery 中继 handler。
 * @param {import('./roomContext.mjs').FederationRelayContext} roomContext 房间上下文
 * @returns {void}
 */
export function registerRelayHandlers(roomContext) {
	const { username, groupId, nodeHash, fedOut, isBlockedPeer } = roomContext

	const bootstrapRequest = wireAction(roomContext, 'fed_bootstrap_request')
	const bootstrapResponse = wireAction(roomContext, 'fed_bootstrap_response')
	const sendBootstrapResponse = bindFedSender(fedOut, 2, 'fed_bootstrap_response', bootstrapResponse.send)

	bootstrapRequest.on((data, peerId) => {
		const request = parseFedBootstrapRequest(data)
		if (!request || request.groupId !== groupId) return
		void handleFedBootstrapRequest(username, groupId, nodeHash, request, peerId, sendBootstrapResponse)
			.catch(error => console.error('federation: fed_bootstrap_request handler failed', error))
	})
	bootstrapResponse.on(data => {
		const response = parseFedBootstrapResponse(data)
		if (!response) return
		void applyFedBootstrapResponse(username, groupId, response)
			.catch(error => console.error('federation: fed_bootstrap_response apply failed', error))
	})

	const joinSnapshotRequest = wireAction(roomContext, 'fed_join_snapshot_request')
	const joinSnapshotResponse = wireAction(roomContext, 'fed_join_snapshot_response')
	const fedShun = wireAction(roomContext, 'fed_shun')

	joinSnapshotRequest.on((data, peerId) => {
		const request = parseJoinSnapshotRequest(data)
		if (!request) return
		void handleJoinSnapshotRequest(username, groupId, request, peerId, (payload, targetPeer) => {
			fedOut.enqueue(2, () => {
				try { joinSnapshotResponse.send(payload, targetPeer) }
				catch (error) { console.error('federation: fed_join_snapshot_response failed', error) }
			})
		}, isBlockedPeer, {
			fedOut,
			fedShunSend: fedShun.send,
			localNodeHash: nodeHash,
		}).catch(error => console.error('federation: fed_join_snapshot_request failed', error))
	})
	joinSnapshotResponse.on((data, peerId) => {
		const response = parseJoinSnapshotResponse(data)
		if (!response) return
		const remoteNodeHash = roomContext.peerToNode?.get(peerId) || ''
		void noteJoinSnapshotResponse(username, groupId, response, remoteNodeHash)
			.catch(error => console.error('federation: fed_join_snapshot_response note failed', error))
	})

	const archiveMonthWant = wireAction(roomContext, 'fed_archive_month_want')
	const archiveMonthResponse = wireAction(roomContext, 'fed_archive_month_response')
	archiveMonthWant.on((data, peerId) => {
		const request = parseFedArchiveMonthWant(data)
		if (!request) return
		void handleFedArchiveMonthWant(username, groupId, request, peerId, (payload, targetPeer) => {
			fedOut.enqueue(2, () => {
				try { archiveMonthResponse.send(payload, targetPeer) }
				catch (error) { console.error('federation: fed_archive_month_response failed', error) }
			})
		}).catch(error => console.error('federation: fed_archive_month_want failed', error))
	})
	archiveMonthResponse.on((data, peerId) => {
		const response = parseFedArchiveMonthResponse(data)
		if (!response) return
		const remoteNodeHash = roomContext.peerToNode?.get(peerId) || ''
		noteFedArchiveMonthResponse(username, groupId, response, remoteNodeHash)
	})

	const archiveDigestObs = wireAction(roomContext, 'fed_archive_digest_obs')
	archiveDigestObs.on(data => {
		if (!data || data.groupId !== groupId) return
		void applyRemoteDigestClaim(username, groupId, data)
			.catch(error => console.error('federation: fed_archive_digest_obs failed', error))
	})

	const discoveryAnnounce = wireAction(roomContext, 'discovery_announce')
	const discoveryQuery = wireAction(roomContext, 'discovery_query')
	const discoveryQueryResponse = wireAction(roomContext, 'discovery_query_response')
	const sendDiscoveryQueryResponse = bindFedSender(fedOut, 3, 'discovery_query_response', discoveryQueryResponse.send)

	discoveryAnnounce.on(data => {
		const announce = parseDiscoveryAnnounce(data)
		if (!announce) return
		void ingestDiscoveryAnnounce(username, announce)
			.catch(error => console.error('federation: discovery_announce failed', error))
	})
	discoveryQuery.on((data, peerId) => {
		const query = parseDiscoveryQuery(data)
		if (!query) return
		void handleDiscoveryQuery(username, nodeHash, query, peerId, sendDiscoveryQueryResponse)
			.catch(error => console.error('federation: discovery_query failed', error))
	})
	discoveryQueryResponse.on(data => {
		const response = parseDiscoveryQueryResponse(data)
		if (!response) return
		void ingestDiscoveryAnnounce(username, response)
			.catch(error => console.error('federation: discovery_query_response ingest failed', error))
	})

}
