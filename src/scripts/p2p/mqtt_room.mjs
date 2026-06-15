/**
 * Trystero MQTT 房间共享配置（chat 联邦 / subfounts 分机共用，§0.4）。
 */
import { wrapTrysteroRoom } from './trystero_session.mjs'

/**
 * 默认公共 MQTT WSS 中继（可被 shellData relayUrls 覆盖）。
 *
 * 必须保持「单一中继」：@trystero-p2p/mqtt 的 topic 策略在配置多个**相互独立**的 broker 集群时，
 * 两个 peer 会被分散到不同 broker 而无法会合（实测两 broker 各自单独可用，但并列即互相看不见）。
 * 跨独立 broker 的冗余需要策略层做桥接，当前 fork 不支持；故以单一确定中继保证 rendezvous。
 * 如需地域优化或私有中继，请用 federation 设置里的 relayUrls 覆盖（同样建议只填一个全网一致的值）。
 */
export const DEFAULT_MQTT_RELAY_URLS = [
	'wss://broker.emqx.io:8084/mqtt',
]

/**
 * 加载 WebRTC 构造函数 polyfill（优先 werift，回退 node-datachannel）。
 * @returns {Promise<typeof import('npm:node-datachannel/polyfill').RTCPeerConnection>} RTCPeerConnection 类
 */
export async function loadRtcPeerConnectionPolyfill() {
	try {
		const { RTCPeerConnection } = await import('npm:werift')
		return RTCPeerConnection
	}
	catch {
		const { RTCPeerConnection } = await import('npm:node-datachannel/polyfill')
		return RTCPeerConnection
	}
}

/**
 * 构造 Trystero `joinRoom` 配置（不含 `rtcPolyfill`，由调用方注入）。
 * @param {object} opts 参数
 * @param {string} opts.appId MQTT 应用 id
 * @param {string} opts.password 房间口令
 * @param {string[]} [opts.relayUrls] WSS 中继列表
 * @returns {{ appId: string, password: string, relayConfig: { urls: string[] } }} Trystero 配置片段
 */
export function buildTrysteroMqttConfig({ appId, password, relayUrls }) {
	// 空数组也回退到默认中继：没有中继 = 没有信令 = 无法会合。
	const urls = Array.isArray(relayUrls) && relayUrls.length ? relayUrls : DEFAULT_MQTT_RELAY_URLS
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
 * 静默 Trystero MQTT socket `error` 事件，避免 ECONNRESET 刷屏。
 * 对每个 relay socket 仅注册一次 handler（幂等，避免监听器累积）。
 * @returns {Promise<void>}
 */
export async function attachTrysteroMqttRelayErrorHandlers() {
	try {
		const mqtt = await import('npm:@trystero-p2p/mqtt')
		if (typeof mqtt.getRelaySockets !== 'function') return
		const sockets = mqtt.getRelaySockets()
		for (const [, socket] of Object.entries(sockets))
			if (socket && typeof socket.on === 'function' && !relaySocketsWithErrorHandler.has(socket)) {
				socket.on('error', () => { })
				relaySocketsWithErrorHandler.add(socket)
			}
	}
	catch { /* optional */ }
}

/**
 * 房间加入串行化的落定窗口（毫秒）。
 *
 * trystero strategy 的 offerPool / didInit / SharedPeerManager 都是**进程级单例**：同一进程并发加入多个
 * room 时，后加入的 room 会与首个 room 的 offerPool warmup（一次性创建 20 个 WebRTC offer 连接）相互竞争，
 * 结果这些 room 全部协商失败、彼此发现不了对端（实测：0 延迟并发双 room 必失败；串行 + 落定延迟必成功）。
 * fount 单进程要同时持有 user room + 多个群联邦 room + subfounts，故所有 joinMqttRoom 必须经队列串行，
 * 且每次加入后留出该窗口让 warmup 落定再放行下一个。
 */
const JOIN_SETTLE_MS = 8000

/**
 * 单次 join 的硬超时（毫秒）。
 *
 * join 经进程级串行队列（每次落定窗口 JOIN_SETTLE_MS），队列积压时单次 join 的等待可被前序 join 无界拖长。
 * 后台 join（联邦写路径触发）若永久挂起会堆积成 OOM。故对每次 join 设硬上限：超时即放弃本次（返回 null），
 * 让上层走 catch-up 最终一致；底层 join 若在超时后才落定，则 leave 该孤儿房间，杜绝 werift 持连泄漏。
 * 取值需 > JOIN_SETTLE_MS，且需覆盖「串行队列等待 + 实际 join + ICE」的背靠背叠加，避免多房间连续 join 时被误杀。
 */
const MQTT_JOIN_HARD_TIMEOUT_MS = 30_000
/**
 * 串行队列尾挂在 globalThis 上：fount 的 parts 可能以不同 URL（file:// 与 http://）载入，
 * 导致本模块出现多个实例。trystero（`npm:` 解析）的 offerPool 单例却全进程唯一，因此串行必须跨模块实例
 * 共享同一条队列，否则 user room 与群联邦 room 经不同 mqtt_room 实例并发加入仍会撞上同一 offerPool warmup。
 */
const JOIN_QUEUE_KEY = Symbol.for('fount.p2p.mqttJoinQueueTail')
if (!globalThis[JOIN_QUEUE_KEY]) globalThis[JOIN_QUEUE_KEY] = Promise.resolve()

/**
 * 静默中继连接错误回调（避免 ECONNRESET 刷屏）。
 * @returns {void}
 */
function silentJoinError() { }

/**
 * 串行执行一次房间加入，并在其后等待 warmup 落定窗口再放行队列中的下一个加入。
 * @template T
 * @param {() => T} createRoom 同步创建并包装 room 的函数
 * @returns {Promise<T>} 创建的 room
 */
function enqueueRoomJoin(createRoom) {
	const result = Promise.resolve(globalThis[JOIN_QUEUE_KEY]).then(createRoom)
	/**
	 * 无论本次加入成功与否，都等待落定窗口再放行下一个（warmup 竞争窗口）。
	 * @returns {Promise<void>} 落定后兑现
	 */
	const settle = () => new Promise(resolve => setTimeout(resolve, JOIN_SETTLE_MS))
	globalThis[JOIN_QUEUE_KEY] = result.then(settle, settle)
	return result
}

/**
 * 加入 Trystero MQTT 房间（经进程级串行队列，规避 offerPool warmup 竞争）。
 * @param {object} config Trystero `joinRoom` 配置（含 `rtcPolyfill`、`rtcConfig`）
 * @param {string} roomId 房间 id
 * @returns {Promise<unknown>} Trystero room
 */
export async function joinMqttRoom(config, roomId) {
	const { joinRoom } = await import('npm:@trystero-p2p/mqtt')
	return enqueueRoomJoin(() => wrapTrysteroRoom(joinRoom(config, roomId, { onJoinError: silentJoinError })))
}

/**
 * 离开 Trystero MQTT 房间，复用 join 的进程级串行队列。
 *
 * 与 join 同队列串行可保证「旧房间 leave 先于后续 join 落定」：trystero 的 offerPool 是进程级单例，
 * 旧房间 teardown 若与新房间 warmup 并发会撞上同一 offerPool；串行化后新 join 必等本次 leave 完成再排队。
 * @param {{ leave?: () => Promise<void> | void } | null | undefined} room 已加入的房间
 * @returns {Promise<void>} leave 完成
 */
export function leaveMqttRoom(room) {
	if (!room || typeof room.leave !== 'function') return Promise.resolve()
	const result = Promise.resolve(globalThis[JOIN_QUEUE_KEY]).then(() => room.leave())
	globalThis[JOIN_QUEUE_KEY] = result.then(() => { }, () => { })
	return result
}

/**
 * 加入 MQTT 房间（加载 polyfill + 默认中继）。
 * @param {object} opts 参数
 * @param {string} opts.appId 应用 id
 * @param {string} opts.password 口令
 * @param {string} opts.roomId 房间名
 * @param {string[]} [opts.relayUrls] 中继
 * @param {{ urls: string, username?: string, credential?: string }[]} [opts.iceServers] ICE/TURN
 * @returns {Promise<unknown>} Trystero room
 */
export async function joinMqttRoomWithDefaults({ appId, password, roomId, relayUrls, iceServers }) {
	const rtcPolyfill = await loadRtcPeerConnectionPolyfill()
	const base = buildTrysteroMqttConfig({ appId, password, relayUrls })
	const rtcConfig = iceServers?.length ? { iceServers } : undefined
	const joinPromise = joinMqttRoom({
		...base,
		rtcPolyfill,
		...rtcConfig ? { rtcConfig } : {},
	}, roomId)
	let timeoutTimer
	const timeoutPromise = new Promise(resolve => {
		timeoutTimer = setTimeout(() => resolve(null), MQTT_JOIN_HARD_TIMEOUT_MS)
	})
	const room = await Promise.race([joinPromise, timeoutPromise])
	clearTimeout(timeoutTimer)
	if (!room) {
		// 串行队列积压导致本次 join 超时：放弃本次（上层走 catch-up 兜底），避免后台 join 永久挂起堆积；
		// 若底层 join 在超时后才落定，leave 这个无人引用的孤儿房间，杜绝 werift 持连泄漏。
		void joinPromise.then(lateRoom => lateRoom ? leaveMqttRoom(lateRoom) : undefined).catch(() => { })
		return null
	}
	await attachTrysteroMqttRelayErrorHandlers()
	return room
}
