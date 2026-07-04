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
 * @returns {{ groupId: string, scope: string, start: () => Promise<void>, leave: () => Promise<void>, getRoster: () => Array<{ peerId: string, remoteNodeHash: string }>, getPeerIdByNodeHash: (nodeHash: string) => string | null, sendToPeer: (peerId: string, actionName: string, payload: unknown) => Promise<boolean>, send: (actionName: string, payload: unknown, peerId?: string | null) => Promise<number>, onEnvelope: (cb: (senderNodeHash: string, envelope: object) => void) => () => void, registerCleanup: (fn: () => void) => void, isActive: () => boolean }}
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
	let active = true

	function registerCleanup(fn) {
		if (typeof fn !== 'function') return
		cleanups.add(fn)
	}

	function activeRoster() {
		return [...members]
			.filter(nodeHash => nodeHash !== selfNodeHash && registry.getLink(nodeHash))
			.map(nodeHash => ({ peerId: nodeHash, remoteNodeHash: nodeHash }))
	}

	async function start() {
		registry.registerScopeInterest(scope, [...members])
		registerCleanup(registry.subscribeScope(scope, (senderNodeHash, envelope) => {
			for (const listener of envelopeListeners)
				listener(senderNodeHash, envelope)
		}))
		registerCleanup(await subscribeTopic(topic, async bytes => {
			const packet = decryptSignalPacket(topic, bytes)
			if (packet?.type !== 'advert' || !packet.body) return
			const verifiedNodeHash = await verifySignedAdvert(topic, packet.body)
			if (!verifiedNodeHash || verifiedNodeHash === selfNodeHash || !members.has(verifiedNodeHash)) return
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
		registerCleanup,
		isActive() { return active },
	}
}
