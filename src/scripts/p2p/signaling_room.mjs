/**
 * Trystero Nostr 房间共享配置（chat 联邦 / subfounts 分机共用，§0.4）。
 */
import { defaultRelayUrls as trysteroDefaultRelayUrls } from 'npm:@trystero-p2p/nostr'

import { debugLog } from '../debug_log.mjs'

import { getSignalingRuntimeConfig } from './node/instance.mjs'
import { wrapRtcPeerConnectionForMdns } from './rtc_mdns_filter.mjs'
import { wrapTrysteroRoom } from './trystero_session.mjs'

/**
 * fount 内置 Nostr relay 精选（与 trystero 库内置默认列表并集使用）。
 */
export const DEFAULT_RELAY_URLS = [
	'wss://relay.damus.io',
	'wss://nos.lol',
	'wss://relay.nostr.band',
]

/**
 * 合并 trystero 库内置、fount 内置与用户自定义 relay URL（去重，保序）。
 * @param {string[] | undefined | null} userRelayUrls 用户 federation 设置中的 relayUrls
 * @returns {string[]} 最终 relay 列表
 */
export function mergeSignalingRelayUrls(userRelayUrls) {
	const seen = new Set()
	/** @type {string[]} */
	const merged = []
	for (const url of [
		...Array.isArray(trysteroDefaultRelayUrls) ? trysteroDefaultRelayUrls : [],
		...DEFAULT_RELAY_URLS,
		...Array.isArray(userRelayUrls) ? userRelayUrls : [],
	]) {
		const trimmed = String(url || '').trim()
		if (!trimmed || seen.has(trimmed)) continue
		seen.add(trimmed)
		merged.push(trimmed)
	}
	return merged.length ? merged : [...DEFAULT_RELAY_URLS]
}

/**
 * 加载 WebRTC 构造函数 polyfill（优先 werift，回退 node-datachannel）。
 * mDNS 策略由 node runtime 信令配置决定。
 * @returns {Promise<typeof import('npm:node-datachannel/polyfill').RTCPeerConnection>} RTCPeerConnection 类
 */
export async function loadRtcPeerConnectionPolyfill() {
	const { mdnsPolicy } = getSignalingRuntimeConfig()
	try {
		const werift = await import('npm:werift')
		const BaseRTC = werift.RTCPeerConnection
		return wrapRtcPeerConnectionForMdns(BaseRTC, werift.RTCIceCandidate, mdnsPolicy)
	}
	catch {
		const ndc = await import('npm:node-datachannel/polyfill')
		const BaseRTC = ndc.RTCPeerConnection
		return wrapRtcPeerConnectionForMdns(BaseRTC, ndc.RTCIceCandidate, mdnsPolicy)
	}
}

/**
 * 构造 Trystero `joinRoom` 配置（不含 `rtcPolyfill`，由调用方注入）。
 * @param {object} opts 参数
 * @param {string} opts.appId 信令应用 id
 * @param {string} opts.password 房间口令
 * @param {string[]} [opts.relayUrls] 用户自定义 WSS relay 列表
 * @returns {{ appId: string, password: string, relayConfig: { urls: string[] } }} Trystero 配置片段
 */
export function buildTrysteroSignalingConfig({ appId, password, relayUrls }) {
	const { relayOverride } = getSignalingRuntimeConfig()
	const urls = relayOverride ?? mergeSignalingRelayUrls(relayUrls)
	return {
		appId: String(appId || '').trim() || 'fount-p2p',
		password: String(password || ''),
		relayConfig: { urls: [...urls] },
	}
}

/**
 * 已挂过静默 `error` handler 的共享 relay socket 集合。
 *
 * relay socket 是 trystero 进程级单例，会被所有房间复用；每次 join 都调用本函数时
 * 必须保证幂等，否则监听器会累积并触发 "AsyncEventEmitter memory leak" 警告。
 */
const relaySocketsWithErrorHandler = new WeakSet()

/**
 * 静默 Trystero Nostr relay socket `error` 事件，避免 ECONNRESET 刷屏。
 * 对每个 relay socket 仅注册一次 handler（幂等，避免监听器累积）。
 * @returns {Promise<void>}
 */
export async function attachTrysteroRelayErrorHandlers() {
	try {
		const nostr = await import('npm:@trystero-p2p/nostr')
		if (typeof nostr.getRelaySockets !== 'function') return
		const sockets = nostr.getRelaySockets()
		for (const [, socket] of Object.entries(sockets))
			if (socket && typeof socket.on === 'function' && !relaySocketsWithErrorHandler.has(socket)) {
				socket.on('error', error => {
					void debugLog('p2p', { event: 'nostr_relay_socket_error', error: String(error) })
				})
				relaySocketsWithErrorHandler.add(socket)
			}
	}
	catch { /* optional */ }
}

/**
 * 首次 join 后的落定窗口（毫秒）：Trystero 0.25 仅在 `!pool.isActive` 时 warmup offerPool。
 * 进程内尚无活跃信令 room 时，需留出该窗口让首次 warmup 落定。
 * 两常量设为相等即回退为固定窗口行为。
 */
const JOIN_SETTLE_FIRST_MS = 8000

/**
 * 后续 join 的落定窗口（毫秒）：offerPool 已 active 时缩短等待。
 */
const JOIN_SETTLE_SUBSEQUENT_MS = 1500

/**
 * 单次 join 的硬超时（毫秒，不含串行队列等待）。
 *
 * 后台 join（联邦写路径触发）若永久挂起会堆积成 OOM。超时只覆盖实际 Trystero joinRoom + ICE，
 * 不含 acquireJoinQueueSlot 的排队等待；超时即放弃本次（返回 null），上层走 catch-up 兜底。
 * 若底层 join 在超时后才落定，则 leave 该孤儿房间，杜绝 werift 持连泄漏。
 */
const SIGNALING_JOIN_HARD_TIMEOUT_MS = 30_000

/**
 * 进程内 join/leave 串行队列尾。
 *
 * Trystero 0.25 的 offerPool / relay socket / SharedPeerManager 均为进程级单例；
 * fount 单进程同时持有 user room + 多个群联邦 room，join/leave 须串行，
 * 且活跃 room 归零时 offerPool 会被销毁——换房须 join-before-leave（见 federation room.mjs）。
 * @type {Promise<void>}
 */
let joinQueueTail = Promise.resolve()

/** @type {Map<object, { appId: string, roomId: string }>} 进程内仍持有引用的 Trystero room */
const activeSignalingRooms = new Map()

/**
 * @param {object} room 已包装 room
 * @param {string} appId 应用 id
 * @param {string} roomId 房间 id
 * @returns {void}
 */
function registerActiveSignalingRoom(room, appId, roomId) {
	activeSignalingRooms.set(room, { appId, roomId: String(roomId || '') })
}

/**
 * @param {object | null | undefined} room 已包装 room
 * @returns {void}
 */
function unregisterActiveSignalingRoom(room) {
	if (!room) return
	activeSignalingRooms.delete(room)
}

/**
 * @returns {number} 当前活跃信令 room 数
 */
export function getActiveSignalingRoomCount() {
	return activeSignalingRooms.size
}

/**
 * Trystero join / handshake 错误回调。
 * @param {{ error?: string, appId?: string, peerId?: string, roomId?: string } | unknown} detail 错误详情
 * @returns {void}
 */
function onSignalingJoinError(detail) {
	void debugLog('p2p', { event: 'signaling_join_error', detail })
}

/**
 * 等待进程级 join/leave 串行队列轮到本调用方。
 * @returns {Promise<() => Promise<void>>} 释放函数（落定窗口结束后放行下一项）
 */
async function acquireJoinQueueSlot() {
	await joinQueueTail
	const settleMs = getActiveSignalingRoomCount() > 0
		? JOIN_SETTLE_SUBSEQUENT_MS
		: JOIN_SETTLE_FIRST_MS
	/** @type {() => void} */
	let releaseSlot
	const slotDone = new Promise(resolve => { releaseSlot = resolve })
	joinQueueTail = slotDone
	return async () => {
		await new Promise(resolve => setTimeout(resolve, settleMs))
		releaseSlot()
	}
}

/**
 * 经进程级串行队列执行 Trystero join（硬超时、孤儿房间回收、早返回）。
 * @param {object} opts 参数
 * @param {string} opts.appId 应用 id
 * @param {string} opts.roomId 房间 id
 * @param {() => object | Promise<object>} opts.buildJoinConfig Trystero joinRoom 配置（含 rtcPolyfill）
 * @returns {Promise<unknown | null>} 包装后的 room；超时返回 null
 */
async function runSerializedJoin({ appId, roomId, buildJoinConfig }) {
	const normalizedAppId = String(appId || '').trim() || 'fount-p2p'
	const normalizedRoomId = String(roomId || '')
	const release = await acquireJoinQueueSlot()
	let timeoutTimer
	/** @type {Promise<unknown> | null} */
	let joinPromise = null
	try {
		const { joinRoom } = await import('npm:@trystero-p2p/nostr')
		joinPromise = Promise.resolve().then(async () => {
			const config = await buildJoinConfig()
			return wrapTrysteroRoom(joinRoom(config, normalizedRoomId, { onJoinError: onSignalingJoinError }))
		})
		const timeoutPromise = new Promise(resolve => {
			timeoutTimer = setTimeout(() => resolve(null), SIGNALING_JOIN_HARD_TIMEOUT_MS)
		})
		const room = await Promise.race([joinPromise, timeoutPromise])
		clearTimeout(timeoutTimer)
		if (!room) {
			void debugLog('p2p', {
				event: 'signaling_join_timed_out',
				roomId: normalizedRoomId,
				appId: normalizedAppId,
			})
			void joinPromise.then(lateRoom => lateRoom ? leaveSignalingRoom(lateRoom) : undefined).catch(() => { })
			await release()
			return null
		}
		registerActiveSignalingRoom(room, normalizedAppId, normalizedRoomId)
		await attachTrysteroRelayErrorHandlers()
		void release()
		return room
	}
	catch (error) {
		await release()
		throw error
	}
}

/**
 * 离开 Trystero Nostr 房间，复用 join 的进程级串行队列。
 *
 * 与 join 同队列串行可保证「旧房间 leave 先于后续 join 落定」：trystero 的 offerPool 是进程级单例，
 * 旧房间 teardown 若与新房间 join 并发会撞上同一 offerPool；串行化后新 join 必等本次 leave 完成再排队。
 * @param {{ leave?: () => Promise<void> | void } | null | undefined} room 已加入的房间
 * @returns {Promise<void>} leave 完成
 */
export async function leaveSignalingRoom(room) {
	if (!room || typeof room.leave !== 'function') return
	const release = await acquireJoinQueueSlot()
	try {
		await room.leave()
		unregisterActiveSignalingRoom(room)
	}
	finally {
		await release()
	}
}

/**
 * 加入 Nostr 信令房间（加载 polyfill + 默认 relay 并集）。
 * @param {object} opts 参数
 * @param {string} opts.appId 应用 id
 * @param {string} opts.password 口令
 * @param {string} opts.roomId 房间名
 * @param {string[]} [opts.relayUrls] 用户自定义 relay
 * @param {{ urls: string, username?: string, credential?: string }[]} [opts.iceServers] ICE/TURN
 * @returns {Promise<unknown>} Trystero room；超时返回 null
 */
export async function joinSignalingRoomWithDefaults({ appId, password, roomId, relayUrls, iceServers }) {
	const rtcPolyfill = await loadRtcPeerConnectionPolyfill()
	const base = buildTrysteroSignalingConfig({ appId, password, relayUrls })
	const rtcConfig = iceServers?.length ? { iceServers } : undefined
	const { trickleIceOff } = getSignalingRuntimeConfig()
	/** @returns {Promise<object>} Trystero joinRoom 配置 */
	const buildJoinConfig = async () => ({
		...base,
		rtcPolyfill,
		...rtcConfig ? { rtcConfig } : {},
		...trickleIceOff ? { trickleIce: false } : {},
	})
	return runSerializedJoin({ appId, roomId, buildJoinConfig })
}
