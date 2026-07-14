import { isHex64, normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { loadPeerPoolView } from 'npm:@steve02081504/fount-p2p/node/network'
import { bumpReputationOnRelay } from 'npm:@steve02081504/fount-p2p/node/reputation_store'
import { mergePexNodeHints } from 'npm:@steve02081504/fount-p2p/transport/peer_pool'
import { wireAction } from 'npm:@steve02081504/fount-p2p/transport/room_wire_action'
import {
	annotateRtcPeerNodeHash,
	isFederationActionAllowedUnderLoad,
	releaseRtcPeer,
	setRtcPeerSource,
	takeRtcJoinSlot,
} from 'npm:@steve02081504/fount-p2p/transport/rtc_connection_budget'
import { isPlainObject } from 'npm:@steve02081504/fount-p2p/wire/ingress'

import { debugLog } from '../../../../../../../../scripts/debug_log.mjs'
import { loadFederationGroupSettings } from '../dagDependencies.mjs'
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
		const remoteNodeHash = normalizeHex64(peerId)
		if (!isHex64(remoteNodeHash) || remoteNodeHash === nodeHash) return
		const previousNodeId = peerToNode.get(peerId)
		if (previousNodeId) nodeToPeer.delete(previousNodeId)
		peerToNode.set(peerId, remoteNodeHash)
		nodeToPeer.set(remoteNodeHash, peerId)
		annotateRtcPeerNodeHash(key, peerId, remoteNodeHash, rtcLimits)
		setRtcPeerSource(key, peerId, remoteNodeHash)
		if (!takeRtcJoinSlot(key, peerId, rtcLimits, peerId)) {
			void debugLog('federation', {
				event: 'onPeerJoin_rtc_slot_denied',
				groupId,
				peerId,
			})
			return
		}
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
		void import('npm:@steve02081504/fount-p2p/trust_graph/cache').then(({ invalidateTrustGraphCache }) => {
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
		void import('npm:@steve02081504/fount-p2p/trust_graph/cache').then(({ invalidateTrustGraphCache }) => {
			invalidateTrustGraphCache()
		}).catch(error => console.warn('federation: invalidateTrustGraphCache failed on leave', error))
	})

}
