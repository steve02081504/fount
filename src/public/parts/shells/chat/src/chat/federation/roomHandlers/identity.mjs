import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { isPlainObject } from 'npm:@steve02081504/fount-p2p/core/object'
import { loadPeerPoolView } from 'npm:@steve02081504/fount-p2p/node/network'
import { bumpReputationOnRelay } from 'npm:@steve02081504/fount-p2p/node/reputation_store'

import { loadFederationGroupSettings } from '../dagDependencies.mjs'
import {
	shouldDropPartitionBridgeUnderLoad,
	takePartitionBridgeForwardSlot,
	takePartitionBridgeSlot,
} from '../partitionBridge.mjs'
import { resolveNodePartitionIds } from '../partitions.mjs'
import { mergePexNodeHints } from '../peerFanout.mjs'
import {
	annotateRtcPeerNodeHash,
	isFederationActionAllowedUnderLoad,
	releaseRtcPeer,
	setRtcPeerSource,
	takeRtcJoinSlot,
} from '../roomLoadBudget.mjs'
import { wireAction } from '../wireAction.mjs'
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
			const remoteNode = data.nodeHash
			const hints = data.hints?.map?.(isHex64)?.filter?.(Boolean)
			if (!isHex64(remoteNode) || remoteNode === nodeHash) return
			const settings = await loadFederationGroupSettings(username, groupId)
			await mergePexNodeHints(groupId, hints, settings)
			if (hints.length)
				await bumpReputationOnRelay(remoteNode, `pex:${remoteNode}`)
		})().catch(error => console.error('federation: fed_pex ingest failed', error))
	})

	room.onPeerJoin(peerId => {
		if (!isHex64(peerId) || peerId === nodeHash) return
		const previousNodeId = peerToNode.get(peerId)
		if (previousNodeId) nodeToPeer.delete(previousNodeId)
		peerToNode.set(peerId, peerId)
		nodeToPeer.set(peerId, peerId)
		annotateRtcPeerNodeHash(key, peerId, peerId, rtcLimits)
		setRtcPeerSource(key, peerId, peerId)
		if (!takeRtcJoinSlot(key, peerId, rtcLimits, peerId)) return
		fedOut.enqueue(4, () => {
			void import('../groupEmojiFederation.mjs').then(({ replicateGroupEmojisToPeer }) => {
				const slot = getSlot()
				if (slot) return replicateGroupEmojisToPeer(username, groupId, peerId, slot)
			}).catch(error => console.warn('federation: replicate emojis to peer failed', error))
		})
		if (!isFederationActionAllowedUnderLoad(key, 'fed_pex', rtcLimits)) return
		void (async () => {
			const stored = loadPeerPoolView(groupId)
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
