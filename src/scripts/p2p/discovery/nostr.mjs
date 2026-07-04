import { randomBytes } from 'node:crypto'

import { schnorr } from 'npm:@noble/curves/secp256k1.js'

import { sha256Hex } from '../crypto.mjs'

export const DEFAULT_RELAY_URLS = [
	'wss://relay.damus.io',
	'wss://nos.lol',
	'wss://relay.nostr.band',
]

export const NOSTR_ADVERT_KIND = 27235
export const NOSTR_SIGNAL_KIND = 27236

/**
 * @param {string[] | undefined | null} userRelayUrls
 * @returns {string[]}
 */
export function mergeSignalingRelayUrls(userRelayUrls) {
	const seen = new Set()
	/** @type {string[]} */
	const merged = []
	for (const url of [...DEFAULT_RELAY_URLS, ...Array.isArray(userRelayUrls) ? userRelayUrls : []]) {
		const trimmed = String(url || '').trim()
		if (!trimmed || seen.has(trimmed)) continue
		seen.add(trimmed)
		merged.push(trimmed)
	}
	return merged.length ? merged : [...DEFAULT_RELAY_URLS]
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToHex(bytes) {
	return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * @param {string} hex
 * @returns {Uint8Array}
 */
function hexToBytes(hex) {
	const normalized = String(hex || '').trim().toLowerCase()
	const out = new Uint8Array(Math.floor(normalized.length / 2))
	for (let index = 0; index < out.length; index++)
		out[index] = parseInt(normalized.slice(index * 2, index * 2 + 2), 16)
	return out
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToBase64(bytes) {
	return btoa(String.fromCharCode(...bytes))
}

/**
 * @param {string} base64
 * @returns {Uint8Array}
 */
function base64ToBytes(base64) {
	return Uint8Array.from(atob(base64).split('').map(ch => ch.charCodeAt(0)))
}

/**
 * @param {number} kind
 * @param {string[][]} tags
 * @param {string} content
 * @param {Uint8Array} secretKey
 * @returns {Promise<object>}
 */
async function signNostrEvent(kind, tags, content, secretKey) {
	const pubkey = bytesToHex(schnorr.getPublicKey(secretKey))
	const created_at = Math.floor(Date.now() / 1000)
	const serialized = JSON.stringify([0, pubkey, created_at, kind, tags, content])
	const id = sha256Hex(serialized)
	const sig = bytesToHex(await schnorr.sign(hexToBytes(id), secretKey))
	return { id, pubkey, created_at, kind, tags, content, sig }
}

/**
 * @param {string} relayUrl
 * @returns {Promise<WebSocket>}
 */
function connectRelay(relayUrl) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(relayUrl)
		const timer = setTimeout(() => {
			try { ws.close() } catch { /* ignore */ }
			reject(new Error(`nostr: connect timeout for ${relayUrl}`))
		}, 10_000)
		ws.addEventListener('open', () => {
			clearTimeout(timer)
			resolve(ws)
		}, { once: true })
		ws.addEventListener('error', () => {
			clearTimeout(timer)
			reject(new Error(`nostr: websocket error for ${relayUrl}`))
		}, { once: true })
	})
}

/**
 * @param {string[]} relayUrls
 * @param {object} event
 * @returns {Promise<void>}
 */
async function publishEvent(relayUrls, event) {
	let published = false
	let lastError = null
	await Promise.allSettled(relayUrls.map(async relayUrl => {
		const ws = await connectRelay(relayUrl)
		try {
			ws.send(JSON.stringify(['EVENT', event]))
			published = true
		}
		catch (error) {
			lastError = error
			throw error
		}
		finally {
			setTimeout(() => { try { ws.close() } catch { /* ignore */ } }, 250)
		}
	}))
	if (!published) throw lastError || new Error('nostr: no relay accepted publish')
}

/**
 * @param {{ relayUrls?: string[] }} [opts]
 * @returns {import('./index.mjs').DiscoveryProvider}
 */
export function createNostrDiscoveryProvider(opts = {}) {
	const relayUrls = mergeSignalingRelayUrls(opts.relayUrls)
	const secretKey = randomBytes(32)
	return {
		id: 'nostr',
		priority: 100,
		caps: { canDiscover: true, canSignal: true, canRelay: false },
		async advertise(topic, bytes) {
			let closed = false
			const publish = async () => {
				if (closed) return
				const event = await signNostrEvent(
					NOSTR_ADVERT_KIND,
					[['t', topic], ['x', 'advert']],
					bytesToBase64(bytes),
					secretKey,
				)
				await publishEvent(relayUrls, event)
			}
			await publish()
			const timer = setInterval(() => { void publish().catch(() => {}) }, 5 * 60_000)
			return () => {
				closed = true
				clearInterval(timer)
			}
		},
		async subscribe(topic, onAdvert) {
			let closed = false
			const sockets = []
			const subscriptionId = randomBytes(8).toString('hex')
			let connected = 0
			for (const relayUrl of relayUrls) {
				let ws
				try { ws = await connectRelay(relayUrl) }
				catch { continue }
				connected++
				sockets.push(ws)
				ws.addEventListener('message', event => {
					if (closed) return
					let parsed
					try { parsed = JSON.parse(String(event.data)) } catch { return }
					if (!Array.isArray(parsed) || parsed[0] !== 'EVENT') return
					const nostrEvent = parsed[2]
					if (nostrEvent?.kind !== NOSTR_ADVERT_KIND) return
					try { onAdvert(base64ToBytes(String(nostrEvent.content || '')), { relayUrl, event: nostrEvent }) }
					catch { /* ignore */ }
				})
				ws.send(JSON.stringify(['REQ', subscriptionId, { kinds: [NOSTR_ADVERT_KIND], '#t': [topic], '#x': ['advert'] }]))
			}
			if (!connected) throw new Error('nostr: no relay available for advert subscribe')
			return () => {
				closed = true
				for (const ws of sockets)
					try { ws.close() } catch { /* ignore */ }
			}
		},
		async sendSignal(topic, to, bytes) {
			const event = await signNostrEvent(
				NOSTR_SIGNAL_KIND,
				[['t', topic], ['x', 'signal'], ['p', String(to || '')]],
				bytesToBase64(bytes),
				secretKey,
			)
			await publishEvent(relayUrls, event)
		},
		async onSignal(topic, onSignal) {
			let closed = false
			const sockets = []
			const subscriptionId = randomBytes(8).toString('hex')
			let connected = 0
			for (const relayUrl of relayUrls) {
				let ws
				try { ws = await connectRelay(relayUrl) }
				catch { continue }
				connected++
				sockets.push(ws)
				ws.addEventListener('message', event => {
					if (closed) return
					let parsed
					try { parsed = JSON.parse(String(event.data)) } catch { return }
					if (!Array.isArray(parsed) || parsed[0] !== 'EVENT') return
					const nostrEvent = parsed[2]
					if (nostrEvent?.kind !== NOSTR_SIGNAL_KIND) return
					try { onSignal(base64ToBytes(String(nostrEvent.content || '')), { relayUrl, event: nostrEvent }) }
					catch { /* ignore */ }
				})
				ws.send(JSON.stringify(['REQ', subscriptionId, { kinds: [NOSTR_SIGNAL_KIND], '#t': [topic], '#x': ['signal'] }]))
			}
			if (!connected) throw new Error('nostr: no relay available for signal subscribe')
			return () => {
				closed = true
				for (const ws of sockets)
					try { ws.close() } catch { /* ignore */ }
			}
		},
	}
}
