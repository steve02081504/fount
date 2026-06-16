import { buildIdentityAnnounce, verifyIdentityAnnounce } from '../../../../../../../../scripts/p2p/identity_announce.mjs'
import { loadPeerPoolView } from '../../../../../../../../scripts/p2p/network.mjs'
import { bumpReputationOnRelay } from '../../../../../../../../scripts/p2p/reputation_user.mjs'
import {
	isFederationActionAllowedUnderLoad,
	releaseRtcPeer,
	takeRtcJoinSlot,
} from '../../../../../../../../scripts/p2p/rtc_connection_budget.mjs'
import { wireAction } from '../../../../../../../../scripts/p2p/trystero_wire_action.mjs'
import { isPlainObject } from '../../../../../../../../scripts/p2p/wire_ingress.mjs'
import { mergePexNodeHints } from '../../governance/peerPool.mjs'
import { loadFederationGroupSettings } from '../deps.mjs'
import {
	shouldDropPartitionBridgeUnderLoad,
	takePartitionBridgeForwardSlot,
	takePartitionBridgeSlot,
} from '../partitionBridge.mjs'
import { resolveNodePartitionIds } from '../partitions.mjs'


/**
 * identity / PEX / partition bridge / peer 生命周期。
 * @param {import('./roomContext.mjs').FederationIdentityContext} roomContext 房间上下文
 * @returns {void}
 */
export function registerIdentityHandlers(roomContext) {
	const {
		username,
		groupId,
		key,
		nodeHash,
		groupSettings,
		room,
		fedOut,
		rtcLimits,
		peerToNode,
		nodeToPeer,
		ensureFederationPartitionRoom,
		getSlot,
	} = roomContext

	const identity = wireAction(roomContext, 'identity_announce')
	identity.on((data, peerId) => {
		void verifyIdentityAnnounce(data, peerId).then(remoteNodeHash => {
			if (!remoteNodeHash) return
			const previousNodeId = peerToNode.get(peerId)
			if (previousNodeId) nodeToPeer.delete(previousNodeId)
			peerToNode.set(peerId, remoteNodeHash)
			nodeToPeer.set(remoteNodeHash, peerId)
		})
	})

	const fedPex = wireAction(roomContext, 'fed_pex')
	fedPex.on((data, peerId) => {
		if (!isFederationActionAllowedUnderLoad(key, 'fed_pex', rtcLimits)) return
		if (!isPlainObject(data)) return
		void (async () => {
			const remoteNode = data.nodeHash?.trim()
			const hints = Array.isArray(data.hints) ? data.hints : []
			if (!remoteNode || remoteNode === nodeHash) return
			const settings = await loadFederationGroupSettings(username, groupId)
			await mergePexNodeHints(username, groupId, hints, settings)
			if (hints.length)
				await bumpReputationOnRelay(username, remoteNode, `pex:${remoteNode}`)
		})().catch(error => console.error('federation: fed_pex ingest failed', error))
	})

	room.onPeerJoin(peerId => {
		if (!takeRtcJoinSlot(key, peerId, rtcLimits)) return
		fedOut.enqueue(3, () => {
			void buildIdentityAnnounce(username, peerId)
				.then(body => { identity.send(body, peerId) })
				.catch(error => console.error('federation: identity_announce failed', error))
		})
		if (!isFederationActionAllowedUnderLoad(key, 'fed_pex', rtcLimits)) return
		void (async () => {
			const stored = loadPeerPoolView(username, groupId)
			const hints = [...stored.trustedPeers, ...stored.explorePeers].slice(0, 48)
			if (hints.length)
				fedOut.enqueue(3, () => {
					if (!isFederationActionAllowedUnderLoad(key, 'fed_pex', rtcLimits)) return
					try { fedPex.send({ nodeHash, hints }, peerId) }
					catch (error) { console.error('federation: fed_pex failed', error) }
				})
		})().catch(error => console.error('federation: onPeerJoin pex failed', error))
		void import('../../../../../../../../scripts/p2p/trust_graph_cache.mjs').then(({ invalidateTrustGraphCache }) => {
			invalidateTrustGraphCache(username)
		}).catch(error => console.warn('federation: invalidateTrustGraphCache failed on join', error))
	})

	const partitionBridge = wireAction(roomContext, 'fed_partition_bridge')
	partitionBridge.on((data, peerId) => {
		void (async () => {
			if (!isPlainObject(data)) return
			const actionName = data.actionName?.trim()
			const targetPartition = data.targetPartition?.trim()
			const dedupeId = data.dedupeId?.trim()
			const ttl = Number(data.ttl ?? 0)
			if (!actionName || !targetPartition || !dedupeId) return
			if (!Number.isFinite(ttl) || ttl <= 0) return
			if (shouldDropPartitionBridgeUnderLoad(key, actionName, rtcLimits)) return
			if (!takePartitionBridgeSlot(`${groupId}:${targetPartition}:${dedupeId}`)) return
			const localPartitions = resolveNodePartitionIds(groupSettings)
			if (!localPartitions.includes(targetPartition)) {
				if (ttl <= 1) return
				if (!takePartitionBridgeForwardSlot(key)) return
				const relayEnvelope = { ...data, ttl: ttl - 1 }
				const slot = getSlot()
				if (!slot) return
				for (const { peerId: remotePeerId } of slot.getRoster())
					if (remotePeerId && remotePeerId !== peerId)
						slot.send('fed_partition_bridge', relayEnvelope, remotePeerId)
				return
			}
			const targetSlot = await ensureFederationPartitionRoom(username, groupId, targetPartition)
			if (!targetSlot) return
			try {
				if (actionName === 'dag_event')
					targetSlot.send('dag_event', data.payload, null)
				else
					targetSlot.sendToPeer(null, actionName, data.payload)
			}
			catch (error) {
				console.warn('federation: partition bridge dispatch failed', error)
			}
		})().catch(error => console.error('federation: partition bridge ingest failed', error))
	})

	room.onPeerLeave(peerId => {
		const remoteNodeHash = peerToNode.get(peerId)
		if (remoteNodeHash) nodeToPeer.delete(remoteNodeHash)
		peerToNode.delete(peerId)
		releaseRtcPeer(key, peerId)
		void import('../../../../../../../../scripts/p2p/trust_graph_cache.mjs').then(({ invalidateTrustGraphCache }) => {
			invalidateTrustGraphCache(username)
		}).catch(error => console.warn('federation: invalidateTrustGraphCache failed on leave', error))
	})

}
