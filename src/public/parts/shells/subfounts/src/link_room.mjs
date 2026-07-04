import { advertiseTopic, subscribeTopic } from '../../../../../scripts/p2p/discovery/index.mjs'
import {
	groupRendezvousTopic,
	decryptSignalPacket,
	encryptSignalPacket,
	getLinkRegistry,
} from '../../../../../scripts/p2p/link_registry.mjs'
import { buildSignedAdvert, verifySignedAdvert } from '../../../../../scripts/p2p/link/handshake.mjs'

/**
 * @param {object} opts
 * @param {string} opts.scope
 * @param {string} opts.roomSecret
 * @param {(nodeHash: string) => boolean} [opts.allowNode]
 * @returns {{ start: () => Promise<void>, leave: () => Promise<void>, makeAction: (name: string) => [(payload: unknown, peerId?: string | string[] | null) => Promise<void>, (handler: (payload: unknown, peerId: string) => void) => void], onPeerJoin: (cb: (peerId: string) => void) => () => void, onPeerLeave: (cb: (peerId: string) => void) => () => void, getPeers: () => Record<string, true> }}
 */
export function createScopedLinkRoom(opts) {
	const registry = getLinkRegistry()
	const scope = String(opts.scope)
	const topic = groupRendezvousTopic(opts.roomSecret)
	const allowNode = typeof opts.allowNode === 'function' ? opts.allowNode : () => true
	/** @type {Set<string>} */
	const discoveredPeers = new Set()
	/** @type {Set<string>} */
	const announcedPeers = new Set()
	/** @type {Set<(peerId: string) => void>} */
	const joinListeners = new Set()
	/** @type {Set<(peerId: string) => void>} */
	const leaveListeners = new Set()
	/** @type {Set<() => void>} */
	const cleanups = new Set()
	/** @type {Map<string, { handler: ((payload: unknown, peerId: string) => void) | null, backlog: Array<{ payload: unknown, peerId: string }> }>} */
	const actionEntries = new Map()

	function activePeerIds() {
		return [...discoveredPeers].filter(nodeHash => allowNode(nodeHash) && registry.getLink(nodeHash))
	}

	function emit(listeners, peerId) {
		for (const listener of listeners)
			try { listener(peerId) } catch { /* ignore */ }
	}

	function notePeerJoin(peerId) {
		if (!peerId || announcedPeers.has(peerId)) return
		announcedPeers.add(peerId)
		emit(joinListeners, peerId)
	}

	function notePeerLeave(peerId) {
		if (!peerId || !announcedPeers.has(peerId)) return
		announcedPeers.delete(peerId)
		emit(leaveListeners, peerId)
	}

	function getActionEntry(name) {
		const key = String(name)
		if (!actionEntries.has(key))
			actionEntries.set(key, { handler: null, backlog: [] })
		return actionEntries.get(key)
	}

	return {
		async start() {
			cleanups.add(registry.subscribeScope(scope, (senderNodeHash, envelope) => {
				if (!allowNode(senderNodeHash)) return
				const entry = actionEntries.get(String(envelope?.action || ''))
				if (!entry) return
				if (entry.handler) entry.handler(envelope.payload, senderNodeHash)
				else entry.backlog.push({ payload: envelope.payload, peerId: senderNodeHash })
			}))
			cleanups.add(registry.onLinkUp(nodeHash => {
				if (!discoveredPeers.has(nodeHash) || !allowNode(nodeHash)) return
				notePeerJoin(nodeHash)
			}))
			cleanups.add(registry.onLinkDown(nodeHash => {
				if (!discoveredPeers.has(nodeHash)) return
				notePeerLeave(nodeHash)
			}))
			cleanups.add(await subscribeTopic(topic, async bytes => {
				const packet = decryptSignalPacket(topic, bytes)
				if (packet?.type !== 'advert' || !packet.body) return
				const verifiedNodeHash = await verifySignedAdvert(topic, packet.body)
				if (!verifiedNodeHash || !allowNode(verifiedNodeHash)) return
				discoveredPeers.add(verifiedNodeHash)
				await registry.ensureLinkToNode(verifiedNodeHash).catch(() => null)
				if (registry.getLink(verifiedNodeHash)) notePeerJoin(verifiedNodeHash)
			}))
			cleanups.add(await advertiseTopic(topic, encryptSignalPacket(topic, {
				type: 'advert',
				body: await buildSignedAdvert(topic, Date.now(), registry.localIdentity),
			})))
			for (const peerId of activePeerIds())
				notePeerJoin(peerId)
		},
		async leave() {
			for (const cleanup of cleanups)
				try { cleanup() } catch { /* ignore */ }
			cleanups.clear()
			for (const peerId of [...announcedPeers])
				notePeerLeave(peerId)
		},
		makeAction(name) {
			const actionName = String(name)
			return [
				async (payload, peerId = null) => {
					if (Array.isArray(peerId)) {
						await Promise.all(peerId.map(targetPeerId =>
							registry.sendToNodeLink(targetPeerId, { scope, action: actionName, payload })))
						return
					}
					if (peerId)
						await registry.sendToNodeLink(peerId, { scope, action: actionName, payload })
					else
						await Promise.all(activePeerIds().map(targetPeerId =>
							registry.sendToNodeLink(targetPeerId, { scope, action: actionName, payload })))
				},
				handler => {
					const entry = getActionEntry(actionName)
					entry.handler = handler
					for (const pending of entry.backlog.splice(0))
						handler(pending.payload, pending.peerId)
				},
			]
		},
		onPeerJoin(cb) {
			joinListeners.add(cb)
			for (const peerId of activePeerIds())
				announcedPeers.add(peerId)
			for (const peerId of announcedPeers)
				try { cb(peerId) } catch { /* ignore */ }
			return () => joinListeners.delete(cb)
		},
		onPeerLeave(cb) {
			leaveListeners.add(cb)
			return () => leaveListeners.delete(cb)
		},
		getPeers() {
			return Object.fromEntries(activePeerIds().map(peerId => [peerId, true]))
		},
	}
}
