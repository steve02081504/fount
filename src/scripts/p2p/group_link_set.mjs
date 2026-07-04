import { advertiseTopic, subscribeTopic } from './discovery/index.mjs'
import {
	groupRendezvousTopic,
	decryptSignalPacket,
	encryptSignalPacket,
	getLinkRegistry,
} from './link_registry.mjs'
import { buildSignedAdvert, verifySignedAdvert } from './link/handshake.mjs'

/**
 * @param {object} opts
 * @param {string} opts.groupId
 * @param {string} opts.roomSecret
 * @param {string[]} opts.members
 * @returns {{ groupId: string, scope: string, start: () => Promise<void>, leave: () => Promise<void>, getRoster: () => Array<{ peerId: string, remoteNodeHash: string }>, getPeerIdByNodeHash: (nodeHash: string) => string | null, sendToPeer: (peerId: string, actionName: string, payload: unknown) => Promise<boolean>, send: (actionName: string, payload: unknown, peerId?: string | null) => Promise<number>, onEnvelope: (cb: (senderNodeHash: string, envelope: object) => void) => () => void, onPeerJoin: (cb: (peerId: string) => void) => () => void, onPeerLeave: (cb: (peerId: string) => void) => () => void, getPeers: () => Record<string, true>, makeAction: (name: string) => [(payload: unknown, peerId?: string | string[] | null) => Promise<void>, (handler: (payload: unknown, peerId: string) => void) => void], registerCleanup: (fn: () => void) => void, isActive: () => boolean }}
 */
export function createGroupLinkSet(opts) {
	const registry = opts.registry ?? getLinkRegistry()
	const autoconnect = opts.autoconnect !== false
	const groupId = String(opts.groupId)
	const scope = `group:${groupId}`
	const topic = groupRendezvousTopic(opts.roomSecret)
	const members = new Set((Array.isArray(opts.members) ? opts.members : []).map(String))
	const selfNodeHash = registry.localIdentity.nodeHash
	/** @type {Set<Function>} */
	const cleanups = new Set()
	/** @type {Set<Function>} */
	const envelopeListeners = new Set()
	/** @type {Set<(peerId: string) => void>} */
	const peerJoinListeners = new Set()
	/** @type {Set<(peerId: string) => void>} */
	const peerLeaveListeners = new Set()
	/** @type {Set<string>} */
	const announcedPeers = new Set()
	/** @type {Map<string, { handler: ((payload: unknown, peerId: string) => void) | null, backlog: Array<{ payload: unknown, peerId: string }> }>} */
	const actionEntries = new Map()
	let active = true

	function registerCleanup(fn) {
		if (typeof fn !== 'function') return
		cleanups.add(fn)
	}

	function emitPeerListeners(listeners, peerId) {
		for (const listener of listeners)
			try { listener(peerId) } catch { /* ignore */ }
	}

	function notePeerJoin(peerId) {
		if (!peerId || announcedPeers.has(peerId)) return
		announcedPeers.add(peerId)
		emitPeerListeners(peerJoinListeners, peerId)
	}

	function notePeerLeave(peerId) {
		if (!peerId || !announcedPeers.has(peerId)) return
		announcedPeers.delete(peerId)
		emitPeerListeners(peerLeaveListeners, peerId)
	}

	function notePeerCandidate(nodeHash) {
		const normalized = String(nodeHash || '')
		if (!normalized || normalized === selfNodeHash || members.has(normalized)) return
		members.add(normalized)
		registry.registerScopeInterest(scope, [...members])
	}

	function getActionEntry(name) {
		const key = String(name)
		if (!actionEntries.has(key))
			actionEntries.set(key, { handler: null, backlog: [] })
		return actionEntries.get(key)
	}

	function activeRoster() {
		return [...members]
			.filter(nodeHash => nodeHash !== selfNodeHash && registry.getLink(nodeHash))
			.map(nodeHash => ({ peerId: nodeHash, remoteNodeHash: nodeHash }))
	}

	async function start() {
		// 房间就绪本身就意味着本节点应当可被发现；不能等到首次外拨 ensureLinkToNode 才懒启动 runtime，
		// 否则“只有自己一个成员”的创建者房间会永远不监听 node topic，后来的 joiner 也就永远拨不进来。
		if (typeof registry.ensureRuntime === 'function')
			await registry.ensureRuntime()
		registry.registerScopeInterest(scope, [...members])
		registerCleanup(registry.subscribeScope(scope, (senderNodeHash, envelope) => {
			notePeerCandidate(senderNodeHash)
			const entry = actionEntries.get(String(envelope?.action || ''))
			if (entry) {
				if (entry.handler) entry.handler(envelope.payload, senderNodeHash)
				else entry.backlog.push({ payload: envelope.payload, peerId: senderNodeHash })
			}
			for (const listener of envelopeListeners)
				listener(senderNodeHash, envelope)
		}))
		registerCleanup(registry.onLinkUp(nodeHash => {
			if (!members.has(nodeHash) || nodeHash === selfNodeHash) return
			notePeerJoin(nodeHash)
		}))
		registerCleanup(registry.onLinkDown(nodeHash => {
			if (!members.has(nodeHash) || nodeHash === selfNodeHash) return
			notePeerLeave(nodeHash)
		}))
		registerCleanup(await subscribeTopic(topic, async bytes => {
			const packet = decryptSignalPacket(topic, bytes)
			if (packet?.type !== 'advert' || !packet.body) return
			const verifiedNodeHash = await verifySignedAdvert(topic, packet.body)
			if (!verifiedNodeHash || verifiedNodeHash === selfNodeHash) return
			notePeerCandidate(verifiedNodeHash)
			await registry.ensureLinkToNode(verifiedNodeHash).catch(() => null)
		}))
		registerCleanup(await advertiseTopic(topic, encryptSignalPacket(topic, {
			type: 'advert',
			body: await buildSignedAdvert(topic, Date.now(), registry.localIdentity),
		})))
		if (autoconnect)
			for (const memberNodeHash of members)
				if (memberNodeHash !== selfNodeHash)
					void registry.ensureLinkToNode(memberNodeHash).catch(() => null)
		for (const { peerId } of activeRoster())
			notePeerJoin(peerId)
	}

	return {
		groupId,
		scope,
		start,
		async leave() {
			if (!active) return
			active = false
			registry.releaseScopeInterest(scope)
			for (const cleanup of cleanups)
				try { cleanup() } catch { /* ignore */ }
			cleanups.clear()
		},
		getRoster: activeRoster,
		getPeerIdByNodeHash(nodeHash) {
			return registry.getLink(nodeHash) ? String(nodeHash) : null
		},
		async sendToPeer(peerId, actionName, payload) {
			return await registry.sendToNodeLink(peerId, { scope, action: String(actionName), payload })
		},
		async send(actionName, payload, peerId = null) {
			if (peerId) return await this.sendToPeer(peerId, actionName, payload) ? 1 : 0
			let sent = 0
			for (const { peerId: targetPeerId } of activeRoster())
				if (await registry.sendToNodeLink(targetPeerId, { scope, action: String(actionName), payload })) sent++
			return sent
		},
		onEnvelope(cb) {
			envelopeListeners.add(cb)
			return () => envelopeListeners.delete(cb)
		},
		onPeerJoin(cb) {
			peerJoinListeners.add(cb)
			for (const { peerId } of activeRoster())
				if (peerId) announcedPeers.add(peerId)
			for (const peerId of announcedPeers)
				try { cb(peerId) } catch { /* ignore */ }
			return () => peerJoinListeners.delete(cb)
		},
		onPeerLeave(cb) {
			peerLeaveListeners.add(cb)
			return () => peerLeaveListeners.delete(cb)
		},
		getPeers() {
			return Object.fromEntries(activeRoster().map(({ peerId }) => [peerId, true]))
		},
		makeAction(name) {
			const actionName = String(name)
			return [
				async (payload, peerId = null) => {
					if (Array.isArray(peerId)) {
						await Promise.all(peerId.map(targetPeerId => this.sendToPeer(targetPeerId, actionName, payload)))
						return
					}
					await this.send(actionName, payload, peerId)
				},
				handler => {
					const entry = getActionEntry(actionName)
					entry.handler = handler
					for (const pending of entry.backlog.splice(0))
						handler(pending.payload, pending.peerId)
				},
			]
		},
		registerCleanup,
		isActive() { return active },
	}
}
