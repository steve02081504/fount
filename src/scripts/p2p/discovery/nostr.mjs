import { randomBytes } from 'node:crypto'

import { schnorr } from 'npm:@noble/curves/secp256k1.js'

import { sha256Hex } from '../crypto.mjs'

/** 默认 Nostr 中继 URL 列表。 */
export const DEFAULT_RELAY_URLS = [
	'wss://relay.damus.io',
	'wss://nos.lol',
	'wss://relay.nostr.band',
]

/** Nostr advert 事件 kind。 */
export const NOSTR_ADVERT_KIND = 27235
/** Nostr signal 事件 kind。 */
export const NOSTR_SIGNAL_KIND = 27236

/**
 * 合并默认与用户配置的中继 URL（去重）。
 * @param {string[] | undefined | null} userRelayUrls 用户自定义中继列表
 * @returns {string[]} 合并后的中继 URL 列表
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
 * 字节数组转十六进制字符串。
 * @param {Uint8Array} bytes 输入字节
 * @returns {string} 小写 hex 字符串
 */
function bytesToHex(bytes) {
	return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * 十六进制字符串转字节数组。
 * @param {string} hex 输入 hex 字符串
 * @returns {Uint8Array} 解码后的字节
 */
function hexToBytes(hex) {
	const normalized = String(hex || '').trim().toLowerCase()
	const out = new Uint8Array(Math.floor(normalized.length / 2))
	for (let index = 0; index < out.length; index++)
		out[index] = parseInt(normalized.slice(index * 2, index * 2 + 2), 16)
	return out
}

/**
 * 字节数组转 base64 字符串。
 * @param {Uint8Array} bytes 输入字节
 * @returns {string} base64 编码
 */
function bytesToBase64(bytes) {
	return btoa(String.fromCharCode(...bytes))
}

/**
 * base64 字符串转字节数组。
 * @param {string} base64 输入 base64 字符串
 * @returns {Uint8Array} 解码后的字节
 */
function base64ToBytes(base64) {
	return Uint8Array.from(atob(base64).split('').map(ch => ch.charCodeAt(0)))
}

/**
 * 签名 Nostr 事件。
 * @param {number} kind 事件 kind
 * @param {string[][]} tags 事件标签
 * @param {string} content 事件内容
 * @param {Uint8Array} secretKey Schnorr 私钥
 * @returns {Promise<object>} 已签名的 Nostr 事件对象
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
 * 连接 Nostr 中继 WebSocket。
 * @param {string} relayUrl 中继 URL
 * @returns {Promise<WebSocket>} 已打开的 WebSocket
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
 * 向多个中继发布 Nostr 事件。
 * @param {string[]} relayUrls 中继 URL 列表
 * @param {object} event 待发布事件
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
 * 创建 Nostr discovery provider。
 * @param {{ relayUrls?: string[] }} [opts] 可选中继 URL 覆盖
 * @returns {import('./index.mjs').DiscoveryProvider} Nostr 发现提供者
 */
export function createNostrDiscoveryProvider(opts = {}) {
	const relayUrls = mergeSignalingRelayUrls(opts.relayUrls)
	const secretKey = randomBytes(32)
	return {
		id: 'nostr',
		priority: 100,
		caps: { canDiscover: true, canSignal: true, canRelay: false },
		/**
		 * 周期性向中继发布 advert 事件。
		 * @param {string} topic advert topic
		 * @param {Uint8Array} bytes advert 载荷
		 * @returns {Promise<() => void>} 取消广播函数
		 */
		async advertise(topic, bytes) {
			let closed = false
			/**
			 * 向中继发布当前 advert。
			 * @returns {Promise<void>}
			 */
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
		/**
		 * 订阅中继上的 advert 事件。
		 * @param {string} topic advert topic
		 * @param {Function} onAdvert advert 回调
		 * @returns {Promise<() => void>} 取消订阅函数
		 */
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
		/**
		 * 向中继发布 signal 事件。
		 * @param {string} topic 信令 topic
		 * @param {string} to 目标节点标识
		 * @param {Uint8Array} bytes 信令载荷
		 * @returns {Promise<void>}
		 */
		async sendSignal(topic, to, bytes) {
			const event = await signNostrEvent(
				NOSTR_SIGNAL_KIND,
				[['t', topic], ['x', 'signal'], ['p', String(to || '')]],
				bytesToBase64(bytes),
				secretKey,
			)
			await publishEvent(relayUrls, event)
		},
		/**
		 * 订阅中继上的 signal 事件。
		 * @param {string} topic 信令 topic
		 * @param {Function} onSignal 信令回调
		 * @returns {Promise<() => void>} 取消订阅函数
		 */
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
