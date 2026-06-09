/**
 * Trystero MQTT 房间共享配置（chat 联邦 / subfounts 分机共用，§0.4）。
 */

/** 默认公共 MQTT WSS 中继（可被 shellData 覆盖）。 */
export const DEFAULT_MQTT_RELAY_URLS = [
	'wss://broker-cn.emqx.io:8084/mqtt',
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
export function buildTrysteroMqttConfig({ appId, password, relayUrls = DEFAULT_MQTT_RELAY_URLS }) {
	return {
		appId: String(appId || '').trim() || 'fount-p2p',
		password: String(password || ''),
		relayConfig: { urls: [...relayUrls] },
	}
}

/**
 * 静默 Trystero MQTT socket `error` 事件，避免 ECONNRESET 刷屏。
 * @returns {Promise<void>}
 */
export async function attachTrysteroMqttRelayErrorHandlers() {
	try {
		const mqtt = await import('npm:@trystero-p2p/mqtt')
		if (typeof mqtt.getRelaySockets !== 'function') return
		const sockets = mqtt.getRelaySockets()
		for (const [, socket] of Object.entries(sockets))
			if (socket && typeof socket.on === 'function')
				socket.on('error', () => { })
	}
	catch { /* optional */ }
}

/**
 * 加入 Trystero MQTT 房间。
 * @param {object} config Trystero `joinRoom` 配置（含 `rtcPolyfill`、`rtcConfig`）
 * @param {string} roomId 房间 id
 * @returns {Promise<unknown>} Trystero room
 */
export async function joinMqttRoom(config, roomId) {
	const { joinRoom } = await import('npm:@trystero-p2p/mqtt')
	return joinRoom(config, roomId, {
		/**
		 * 静默中继连接错误，避免 ECONNRESET 刷屏
		 */
		onJoinError: () => { },
	})
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
	const room = await joinMqttRoom({
		...base,
		rtcPolyfill,
		...rtcConfig ? { rtcConfig } : {},
	}, roomId)
	await attachTrysteroMqttRelayErrorHandlers()
	return room
}
