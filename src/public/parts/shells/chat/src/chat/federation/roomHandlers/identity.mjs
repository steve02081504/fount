import { isHex64, normalizeHex64 } from '../../../../../../../../scripts/p2p/hexIds.mjs'
import { buildIdentityAnnounce, verifyIdentityAnnounce } from '../../../../../../../../scripts/p2p/identity_announce.mjs'
import { loadPeerPoolView } from '../../../../../../../../scripts/p2p/network.mjs'
import { mergePexNodeHints } from '../../../../../../../../scripts/p2p/peer_pool.mjs'
import { bumpReputationOnRelay } from '../../../../../../../../scripts/p2p/reputation.mjs'
import {
	annotateRtcPeerNodeHash,
	isFederationActionAllowedUnderLoad,
	releaseRtcPeer,
	setRtcPeerSource,
	takeRtcJoinSlot,
} from '../../../../../../../../scripts/p2p/rtc_connection_budget.mjs'
import { wireAction } from '../../../../../../../../scripts/p2p/trystero_wire_action.mjs'
import { isPlainObject } from '../../../../../../../../scripts/p2p/wire_ingress.mjs'
import { loadFederationGroupSettings } from '../deps.mjs'
import {
	shouldDropPartitionBridgeUnderLoad,
	takePartitionBridgeForwardSlot,
	takePartitionBridgeSlot,
} from '../partitionBridge.mjs'
import { resolveNodePartitionIds } from '../partitions.mjs'
import { parsePartitionBridgePayload } from '../wireSchemas.mjs'


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
			if (!remoteNodeHash) {
				if (process.env.FOUNT_TEST === '1')
					console.warn('federation: identity_announce verify failed', { groupId, peerId })
				return
			}
			const previousNodeId = peerToNode.get(peerId)
			if (previousNodeId) nodeToPeer.delete(previousNodeId)
			peerToNode.set(peerId, remoteNodeHash)
			nodeToPeer.set(remoteNodeHash, peerId)
			annotateRtcPeerNodeHash(key, peerId, remoteNodeHash, rtcLimits)
			setRtcPeerSource(key, peerId, remoteNodeHash)
		})
	})

	const fedPex = wireAction(roomContext, 'fed_pex')
	fedPex.on((data, peerId) => {
		if (!isFederationActionAllowedUnderLoad(key, 'fed_pex', rtcLimits)) return
		if (!isPlainObject(data)) return
		void (async () => {
			const remoteNode = normalizeHex64(data.nodeHash)
			const hints = (Array.isArray(data.hints) ? data.hints : [])
				.map(id => normalizeHex64(id))
				.filter(isHex64)
			if (!isHex64(remoteNode) || remoteNode === nodeHash) return
			const settings = await loadFederationGroupSettings(username, groupId)
			await mergePexNodeHints(groupId, hints, settings)
			if (hints.length)
				await bumpReputationOnRelay( remoteNode, `pex:${remoteNode}`)
		})().catch(error => console.error('federation: fed_pex ingest failed', error))
	})

	room.onPeerJoin(peerId => {
		if (!takeRtcJoinSlot(key, peerId, rtcLimits, peerId)) {
			if (process.env.FOUNT_TEST === '1')
				console.warn('federation: onPeerJoin rtc slot denied', { groupId, peerId })
			return
		}
		fedOut.enqueue(3, () => {
			void buildIdentityAnnounce()
				.then(body => { identity.send(body, peerId) })
				.catch(error => console.error('federation: identity_announce failed', error))
		})
		fedOut.enqueue(4, () => {
			void import('../groupEmojiFederation.mjs').then(({ replicateGroupEmojisToPeer }) => {
				const slot = getSlot()
				if (slot) return replicateGroupEmojisToPeer(username, groupId, peerId, slot)
			}).catch(error => console.warn('federation: replicate emojis to peer failed', error))
		})
		if (!isFederationActionAllowedUnderLoad(key, 'fed_pex', rtcLimits)) return
		void (async () => {
			const stored = loadPeerPoolView( groupId)
			const hints = [...stored.trustedPeers, ...stored.explorePeers].slice(0, 48)
			if (hints.length)
				fedOut.enqueue(3, () => {
					if (!isFederationActionAllowedUnderLoad(key, 'fed_pex', rtcLimits)) return
					try { fedPex.send({ nodeHash, hints }, peerId) }
					catch (error) { console.error('federation: fed_pex failed', error) }
				})
		})().catch(error => console.error('federation: onPeerJoin pex failed', error))
		void import('../../../../../../../../scripts/p2p/trust_graph_cache.mjs').then(({ invalidateTrustGraphCache }) => {
			invalidateTrustGraphCache()
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
			const parsedPayload = parsePartitionBridgePayload(actionName, data.payload, groupId)
			if (!parsedPayload) return
			if (shouldDropPartitionBridgeUnderLoad(key, actionName, rtcLimits)) return
			if (!takePartitionBridgeSlot(`${groupId}:${targetPartition}:${dedupeId}`)) return
			const localPartitions = resolveNodePartitionIds(groupSettings)
			if (!localPartitions.includes(targetPartition)) {
				if (ttl <= 1) return
				if (!takePartitionBridgeForwardSlot(key)) return
				const relayEnvelope = { ...data, payload: parsedPayload, ttl: ttl - 1 }
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
				targetSlot.send('dag_event', parsedPayload, null)
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
			invalidateTrustGraphCache()
		}).catch(error => console.warn('federation: invalidateTrustGraphCache failed on leave', error))
	})

}
