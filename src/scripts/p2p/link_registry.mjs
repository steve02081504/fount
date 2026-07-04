import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import process from 'node:process'

import { createLruMap } from '../memo.mjs'
import { sha256Hex, keyPairFromSeed, pubKeyHash } from './crypto.mjs'
import { mergeSignalingRelayUrls, createNostrDiscoveryProvider } from './discovery/nostr.mjs'
import { advertiseTopic, listenSignals, listDiscoveryProviders, registerDiscoveryProvider, sendSignal, subscribeTopic } from './discovery/index.mjs'
import { compareHex64Asc, normalizeHex64 } from './hexIds.mjs'
import { DEFAULT_ICE_SERVERS } from './ice_servers.mjs'
import { buildSignedAdvert, verifySignedAdvert } from './link/handshake.mjs'
import { createLink, shouldCloseOwnInitiated } from './link/link.mjs'
import { ensureNodeSeed, getNodeHash, getNodeTransportSettings } from './node/identity.mjs'

const SIGNAL_DOMAIN = 'fount-signal-v1'
const NODE_TOPIC_DOMAIN = 'fount-rdv-node:'
const GROUP_TOPIC_DOMAIN = 'fount-rdv-group:'

/**
 * @param {string} nodeHash
 * @returns {string}
 */
export function nodeRendezvousTopic(nodeHash) {
	return sha256Hex(`${NODE_TOPIC_DOMAIN}${normalizeHex64(nodeHash)}`)
}

/**
 * @param {string} roomSecret
 * @returns {string}
 */
export function groupRendezvousTopic(roomSecret) {
	return sha256Hex(`${GROUP_TOPIC_DOMAIN}${String(roomSecret || '')}`)
}

/**
 * @param {string} topic
 * @returns {Buffer}
 */
function signalKeyForTopic(topic) {
	return createHash('sha256').update(`${SIGNAL_DOMAIN}:${String(topic)}`).digest()
}

/**
 * @param {string} topic
 * @param {unknown} packet
 * @returns {Uint8Array}
 */
export function encryptSignalPacket(topic, packet) {
	const iv = randomBytes(12)
	const cipher = createCipheriv('aes-256-gcm', signalKeyForTopic(topic), iv)
	const ciphertext = Buffer.concat([
		cipher.update(Buffer.from(JSON.stringify(packet), 'utf8')),
		cipher.final(),
	])
	return Buffer.from(JSON.stringify({
		iv: iv.toString('base64'),
		authTag: cipher.getAuthTag().toString('base64'),
		ciphertext: ciphertext.toString('base64'),
	}))
}

/**
 * @param {string} topic
 * @param {Uint8Array} bytes
 * @returns {object | null}
 */
export function decryptSignalPacket(topic, bytes) {
	try {
		const payload = JSON.parse(Buffer.from(bytes).toString('utf8'))
		const decipher = createDecipheriv(
			'aes-256-gcm',
			signalKeyForTopic(topic),
			Buffer.from(payload.iv, 'base64'),
		)
		decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'))
		const plain = Buffer.concat([
			decipher.update(Buffer.from(payload.ciphertext, 'base64')),
			decipher.final(),
		])
		return JSON.parse(plain.toString('utf8'))
	}
	catch {
		return null
	}
}

/**
 * @param {{ nodeHash?: string, nodePubKey?: string, secretKey?: Uint8Array } | undefined} localIdentity
 * @returns {{ nodeHash: string, nodePubKey: string, secretKey: Uint8Array }}
 */
function resolveLocalIdentity(localIdentity) {
	if (localIdentity?.nodeHash && localIdentity?.nodePubKey && localIdentity?.secretKey)
		return {
			nodeHash: normalizeHex64(localIdentity.nodeHash),
			nodePubKey: normalizeHex64(localIdentity.nodePubKey),
			secretKey: localIdentity.secretKey,
		}
	const secretKey = Buffer.from(ensureNodeSeed(), 'hex')
	const { publicKey } = keyPairFromSeed(secretKey)
	return {
		nodeHash: getNodeHash(),
		nodePubKey: Buffer.from(publicKey).toString('hex'),
		secretKey,
	}
}

/**
 * @param {(message: unknown) => Promise<void>} sendRemote
 * @returns {{ send: (message: unknown) => Promise<void>, onRemote: (handler: (message: unknown) => void) => () => void, deliver: (message: unknown) => void, clear: () => void }}
 */
function createBufferedSignalSession(sendRemote) {
	/** @type {Set<(message: unknown) => void>} */
	const handlers = new Set()
	/** @type {unknown[]} */
	const backlog = []
	return {
		async send(message) {
			await sendRemote(message)
		},
		onRemote(handler) {
			handlers.add(handler)
			for (const pending of backlog.splice(0))
				handler(pending)
			return () => handlers.delete(handler)
		},
		deliver(message) {
			if (!handlers.size) {
				backlog.push(message)
				return
			}
			for (const handler of handlers)
				handler(message)
		},
		clear() {
			backlog.length = 0
			handlers.clear()
		},
	}
}

/**
 * @param {Map<string, Set<Function>>} buckets
 * @param {string} key
 * @param {Function} listener
 * @returns {() => void}
 */
function subscribeBucket(buckets, key, listener) {
	if (!buckets.has(key)) buckets.set(key, new Set())
	buckets.get(key).add(listener)
	return () => {
		const set = buckets.get(key)
		if (!set) return
		set.delete(listener)
		if (!set.size) buckets.delete(key)
	}
}

/**
 * @param {object} [opts]
 * @param {{ nodeHash?: string, nodePubKey?: string, secretKey?: Uint8Array }} [opts.localIdentity]
 * @param {typeof createLink} [opts.createLink]
 * @param {RTCConfiguration['iceServers']} [opts.iceServers]
 * @param {number} [opts.maxActive]
 * @returns {object}
 */
export function createLinkRegistry(opts = {}) {
	const localIdentity = resolveLocalIdentity(opts.localIdentity)
	const createLinkImpl = opts.createLink ?? createLink
	const iceServers = opts.iceServers?.length ? opts.iceServers : DEFAULT_ICE_SERVERS
	const maxActive = Math.max(4, Number(opts.maxActive) || 32)
	const selfTopic = nodeRendezvousTopic(localIdentity.nodeHash)
	/** @type {Map<string, Awaited<ReturnType<typeof createLinkImpl>>>} */
	const links = new Map()
	/** @type {Map<string, Promise<Awaited<ReturnType<typeof createLinkImpl>> | null>>} */
	const inflights = new Map()
	/** @type {Map<string, ReturnType<typeof createBufferedSignalSession>>} */
	const signalSessions = new Map()
	/** @type {Map<string, Set<string>>} */
	const scopeInterests = new Map()
	/** @type {Map<string, Set<Function>>} */
	const scopeListeners = new Map()
	/** @type {Map<string, Function>} */
	const scopeAuthorizers = new Map()
	/** @type {Set<(nodeHash: string, link: unknown) => void>} */
	const linkUpListeners = new Set()
	/** @type {Set<(nodeHash: string, reason: string) => void>} */
	const linkDownListeners = new Set()
	const recentAdverts = createLruMap(1024)
	let runtimeStarted = false
	let stopAdvert = null
	let stopSignalListener = null

	/**
	 * @returns {Promise<void>}
	 */
	async function ensureDiscoveryRuntime() {
		if (runtimeStarted) return
		runtimeStarted = true
		if (!listDiscoveryProviders().length && !(process.env.FOUNT_TEST === '1' && !process.env.FOUNT_TEST_RELAY_URLS))
			registerDiscoveryProvider(createNostrDiscoveryProvider({
				relayUrls: mergeSignalingRelayUrls(getNodeTransportSettings().relayUrls),
			}))
		if (!listDiscoveryProviders().length) return
		stopSignalListener = await listenSignals(selfTopic, bytes => {
			void handleIncomingSignal(bytes).catch(() => {})
		})
		stopAdvert = await advertiseTopic(selfTopic, encryptSignalPacket(selfTopic, {
			type: 'advert',
			body: await buildSignedAdvert(selfTopic, Date.now(), localIdentity),
		}))
	}

	/**
	 * @param {string} remoteNodeHash
	 * @returns {ReturnType<typeof createBufferedSignalSession>}
	 */
	function getOrCreateSignalSession(remoteNodeHash) {
		const normalized = normalizeHex64(remoteNodeHash)
		let session = signalSessions.get(normalized)
		if (session) return session
		session = createBufferedSignalSession(async message => {
			await sendSignal(
				nodeRendezvousTopic(normalized),
				normalized,
				encryptSignalPacket(nodeRendezvousTopic(normalized), {
					type: 'signal',
					from: localIdentity.nodeHash,
					body: message,
				}),
			)
		})
		signalSessions.set(normalized, session)
		return session
	}

	/**
	 * @param {string} remoteNodeHash
	 * @param {Awaited<ReturnType<typeof createLinkImpl>>} link
	 * @returns {void}
	 */
	function wireLink(remoteNodeHash, link) {
		link.onEnvelope((envelope, senderNodeHash) => {
			void dispatchEnvelope(senderNodeHash, envelope, link).catch(() => {})
		})
		link.onDown(reason => {
			if (links.get(remoteNodeHash) === link) links.delete(remoteNodeHash)
			for (const listener of linkDownListeners)
				try { listener(remoteNodeHash, reason) } catch { /* ignore */ }
		})
	}

	/**
	 * @param {string} remoteNodeHash
	 * @param {Awaited<ReturnType<typeof createLinkImpl>>} candidate
	 * @returns {Promise<void>}
	 */
	async function registerResolvedLink(remoteNodeHash, candidate) {
		const normalized = normalizeHex64(remoteNodeHash)
		const existing = links.get(normalized)
		if (existing && existing !== candidate) {
			if (candidate.initiator && shouldCloseOwnInitiated(localIdentity.nodeHash, normalized))
				await candidate.close('glare-loser')
			else
				await existing.close('replaced-by-new-link')
		}
		links.set(normalized, candidate)
		wireLink(normalized, candidate)
		for (const listener of linkUpListeners)
			try { listener(normalized, candidate) } catch { /* ignore */ }
	}

	/**
	 * @param {Uint8Array} bytes
	 * @returns {Promise<void>}
	 */
	async function handleIncomingSignal(bytes) {
		const packet = decryptSignalPacket(selfTopic, bytes)
		if (!packet || packet.type !== 'signal') return
		const remoteNodeHash = normalizeHex64(packet.from)
		if (!remoteNodeHash || remoteNodeHash === localIdentity.nodeHash) return
		const session = getOrCreateSignalSession(remoteNodeHash)
		if (!links.has(remoteNodeHash) && !inflights.has(remoteNodeHash)) {
			inflights.set(remoteNodeHash, (async () => {
				const link = await createLinkImpl({
					nodeHash: remoteNodeHash,
					initiator: false,
					signal: session,
					iceServers,
					localIdentity,
				})
				await link.ready
				await registerResolvedLink(remoteNodeHash, link)
				return link
			})().finally(() => inflights.delete(remoteNodeHash)))
		}
		session.deliver(packet.body)
	}

	/**
	 * @param {string} remoteNodeHash
	 * @returns {number}
	 */
	function scopeWeight(remoteNodeHash) {
		let weight = 0
		for (const hashes of scopeInterests.values())
			if (hashes.has(remoteNodeHash)) weight++
		return weight
	}

	/**
	 * @returns {Promise<void>}
	 */
	async function trimToBudget() {
		if (links.size < maxActive) return
		const candidates = [...links.entries()]
			.sort((left, right) => scopeWeight(left[0]) - scopeWeight(right[0]) || compareHex64Asc(left[0], right[0]))
		const victim = candidates[0]
		if (victim) await victim[1].close('budget-evict')
	}

	/**
	 * @param {string} remoteNodeHash
	 * @returns {Promise<Awaited<ReturnType<typeof createLinkImpl>> | null>}
	 */
	async function ensureLinkToNode(remoteNodeHash) {
		await ensureDiscoveryRuntime()
		const normalized = normalizeHex64(remoteNodeHash)
		if (!normalized || normalized === localIdentity.nodeHash) return null
		if (links.has(normalized)) return links.get(normalized)
		if (inflights.has(normalized)) return await inflights.get(normalized)
		const session = getOrCreateSignalSession(normalized)
		const task = (async () => {
			await trimToBudget()
			const link = await createLinkImpl({
				nodeHash: normalized,
				initiator: true,
				signal: session,
				iceServers,
				localIdentity,
			})
			await link.ready
			await registerResolvedLink(normalized, link)
			return link
		})().finally(() => inflights.delete(normalized))
		inflights.set(normalized, task)
		return await task
	}

	/**
	 * @param {string} remoteNodeHash
	 * @param {{ scope: string, action: string, payload: unknown }} envelope
	 * @returns {Promise<boolean>}
	 */
	async function sendToNodeLink(remoteNodeHash, envelope) {
		const link = await ensureLinkToNode(remoteNodeHash)
		if (!link) return false
		return await link.send(envelope)
	}

	/**
	 * @param {string} senderNodeHash
	 * @param {{ scope: string, action: string, payload: unknown }} envelope
	 * @param {Awaited<ReturnType<typeof createLinkImpl>>} link
	 * @returns {Promise<void>}
	 */
	async function dispatchEnvelope(senderNodeHash, envelope, link) {
		const scope = String(envelope?.scope || '')
		for (const [prefix, authorizer] of scopeAuthorizers.entries())
			if (scope.startsWith(prefix)) {
				const allowed = await Promise.resolve(authorizer(scope, senderNodeHash, envelope, link))
				if (!allowed) return
			}
		for (const [prefix, listeners] of scopeListeners.entries())
			if (scope.startsWith(prefix))
				for (const listener of listeners)
					await Promise.resolve(listener(senderNodeHash, envelope, link))
	}

	/**
	 * @param {string} prefix
	 * @param {(senderNodeHash: string, envelope: { scope: string, action: string, payload: unknown }, link: Awaited<ReturnType<typeof createLinkImpl>>) => void | Promise<void>} listener
	 * @returns {() => void}
	 */
	function subscribeScope(prefix, listener) {
		return subscribeBucket(scopeListeners, String(prefix), listener)
	}

	/**
	 * @param {string} prefix
	 * @param {(scope: string, senderNodeHash: string, envelope: object, link: Awaited<ReturnType<typeof createLinkImpl>>) => boolean | Promise<boolean>} authorizer
	 * @returns {() => void}
	 */
	function registerScopeAuthorizer(prefix, authorizer) {
		scopeAuthorizers.set(String(prefix), authorizer)
		return () => scopeAuthorizers.delete(String(prefix))
	}

	return {
		localIdentity,
		ensureRuntime: ensureDiscoveryRuntime,
		ensureLinkToNode,
		getLink(nodeHash) {
			return links.get(normalizeHex64(nodeHash)) || null
		},
		listLinks() {
			return [...links.entries()].map(([nodeHash, link]) => ({ nodeHash, link }))
		},
		async closeLink(nodeHash, reason = 'manual-close') {
			const normalized = normalizeHex64(nodeHash)
			const link = links.get(normalized)
			if (!link) return
			await link.close(reason)
		},
		sendToNodeLink,
		onLinkUp(listener) {
			linkUpListeners.add(listener)
			return () => linkUpListeners.delete(listener)
		},
		onLinkDown(listener) {
			linkDownListeners.add(listener)
			return () => linkDownListeners.delete(listener)
		},
		registerScopeInterest(scope, nodeHashes) {
			scopeInterests.set(String(scope), new Set((Array.isArray(nodeHashes) ? nodeHashes : []).map(normalizeHex64).filter(Boolean)))
		},
		releaseScopeInterest(scope) {
			scopeInterests.delete(String(scope))
		},
		registerScopeAuthorizer,
		subscribeScope,
		async subscribeNodeAdvert(nodeHash, onAdvert) {
			const topic = nodeRendezvousTopic(nodeHash)
			return await subscribeTopic(topic, async bytes => {
				const packet = decryptSignalPacket(topic, bytes)
				if (packet?.type !== 'advert') return
				const verifiedNodeHash = await verifySignedAdvert(topic, packet.body)
				if (!verifiedNodeHash) return
				recentAdverts.touch(verifiedNodeHash, Date.now())
				await Promise.resolve(onAdvert(verifiedNodeHash, packet.body))
			})
		},
		recentAdverts,
		async shutdown() {
			stopAdvert?.()
			stopSignalListener?.()
			for (const link of links.values())
				await link.close('registry-shutdown')
			links.clear()
			inflights.clear()
			for (const session of signalSessions.values()) session.clear()
			signalSessions.clear()
		},
	}
}

let defaultRegistry = null

/**
 * @returns {ReturnType<typeof createLinkRegistry>}
 */
export function getLinkRegistry() {
	if (!defaultRegistry) defaultRegistry = createLinkRegistry()
	return defaultRegistry
}

export const ensureLinkToNode = (...args) => getLinkRegistry().ensureLinkToNode(...args)
export const getLink = (...args) => getLinkRegistry().getLink(...args)
export const listLinks = (...args) => getLinkRegistry().listLinks(...args)
export const closeLink = (...args) => getLinkRegistry().closeLink(...args)
export const sendToNodeLink = (...args) => getLinkRegistry().sendToNodeLink(...args)
export const onLinkUp = (...args) => getLinkRegistry().onLinkUp(...args)
export const onLinkDown = (...args) => getLinkRegistry().onLinkDown(...args)
export const registerScopeInterest = (...args) => getLinkRegistry().registerScopeInterest(...args)
export const releaseScopeInterest = (...args) => getLinkRegistry().releaseScopeInterest(...args)
export const registerScopeAuthorizer = (...args) => getLinkRegistry().registerScopeAuthorizer(...args)
export const subscribeScope = (...args) => getLinkRegistry().subscribeScope(...args)
