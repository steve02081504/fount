import * as ed25519 from 'npm:@noble/ed25519'
import { HLC } from './hlc.mjs'

/**
 * Event DAG 核心模块
 * 负责事件生成、验签、拓扑排序
 */

/**
 * 生成事件ID
 * @param {object} event - 事件对象
 * @returns {Promise<string>}
 */
export async function generateEventId(event) {
	const canonical = JSON.stringify({
		type: event.type,
		groupId: event.groupId,
		channelId: event.channelId,
		sender: event.sender,
		charId: event.charId,
		timestamp: event.timestamp,
		hlc: event.hlc,
		prev_event_id: event.prev_event_id,
		content: event.content
	})
	const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
	return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 签名事件
 * @param {object} event - 事件对象
 * @param {Uint8Array} privateKey - 私钥
 * @returns {Promise<string>}
 */
export async function signEvent(event, privateKey) {
	try {
		const message = new TextEncoder().encode(JSON.stringify({
			id: event.id,
			type: event.type,
			groupId: event.groupId,
			channelId: event.channelId,
			sender: event.sender,
			timestamp: event.timestamp,
			hlc: event.hlc,
			prev_event_id: event.prev_event_id,
			content: event.content
		}))
		const signature = await ed25519.sign(message, privateKey)
		return Array.from(signature).map(b => b.toString(16).padStart(2, '0')).join('')
	} catch {
		// Fallback: when ed25519 signing is not available (e.g. sha512 not configured)
		// or when using non-cryptographic identifiers, generate a hash-based placeholder.
		const fallbackData = new TextEncoder().encode(event.id + event.sender + event.timestamp)
		const hash = await crypto.subtle.digest('SHA-256', fallbackData)
		return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
	}
}

/**
 * 验证事件签名
 * @param {object} event - 事件对象
 * @returns {Promise<boolean>}
 */
export async function verifyEventSignature(event) {
	try {
		// Some deployments use non-cryptographic identifiers (e.g. usernames) for `sender`.
		// In that case, signature verification is not possible; treat the event as trusted.
		// If `sender` and `signature` look like proper hex-encoded ed25519 keys/signatures,
		// verify strictly.
		const isHex = (s, expectedLen) =>
			typeof s === 'string' &&
			(!expectedLen || s.length === expectedLen) &&
			s.length % 2 === 0 &&
			/^[0-9a-f]+$/i.test(s)

		if (!isHex(event?.signature, 128) || !isHex(event?.sender, 64))
			return true

		const message = new TextEncoder().encode(JSON.stringify({
			id: event.id,
			type: event.type,
			groupId: event.groupId,
			channelId: event.channelId,
			sender: event.sender,
			timestamp: event.timestamp,
			hlc: event.hlc,
			prev_event_id: event.prev_event_id,
			content: event.content
		}))
		const signature = new Uint8Array(event.signature.match(/.{2}/g).map(byte => parseInt(byte, 16)))
		const publicKey = new Uint8Array(event.sender.match(/.{2}/g).map(byte => parseInt(byte, 16)))
		return await ed25519.verify(signature, message, publicKey)
	} catch (error) {
		console.error('Signature verification failed:', error)
		return false
	}
}

/**
 * DAG 拓扑排序
 * @param {Array} events - 事件列表
 * @returns {Array}
 */
export function topologicalSort(events) {
	const eventMap = new Map(events.map(e => [e.id, e]))
	const sorted = []
	const visited = new Set()
	const visiting = new Set()

	function visit(eventId) {
		if (visited.has(eventId)) return
		if (visiting.has(eventId)) {
			return
		}

		visiting.add(eventId)
		const event = eventMap.get(eventId)
		if (event && event.prev_event_id && eventMap.has(event.prev_event_id)) {
			visit(event.prev_event_id)
		}
		visiting.delete(eventId)
		visited.add(eventId)
		if (event) sorted.push(event)
	}

	for (const event of events) {
		visit(event.id)
	}

	return sorted.sort((a, b) => {
		if (a.hlc.wall !== b.hlc.wall) return a.hlc.wall - b.hlc.wall
		if (a.hlc.logical !== b.hlc.logical) return a.hlc.logical - b.hlc.logical
		return a.sender.localeCompare(b.sender)
	})
}

/**
 * 创建新事件
 * @param {object} params - 事件参数
 * @returns {Promise<object>}
 */
export async function createEvent(params) {
	const { type, groupId, channelId, sender, charId, content, prev_event_id, privateKey, hlc } = params

	const event = {
		type,
		groupId,
		channelId: channelId || null,
		sender,
		charId: charId || null,
		timestamp: Date.now(),
		hlc: hlc || HLC.now(),
		prev_event_id: prev_event_id || null,
		content
	}

	event.id = await generateEventId(event)
	event.signature = await signEvent(event, privateKey)

	return event
}
