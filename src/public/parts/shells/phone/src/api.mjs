// 手机 Agent 环境：设备连接注册表与远程执行通道。
//
// 安卓客户端（fount-app）通过 WS /ws/parts/shells:phone/device 接入；
// 本模块维护按用户隔离的设备表与「服务端发起 → 手机响应」的请求关联，
// 并把手机自动上报的屏幕/摄像头/通知上下文存在内存快照里。
import { randomUUID } from 'node:crypto'
import { setInterval, setTimeout } from 'node:timers'

import { httpError } from '../../../../../scripts/http_error.mjs'
import { ms } from '../../../../../scripts/ms.mjs'

/** 单次远程命令的默认超时（毫秒）。 */
const DEFAULT_REQUEST_TIMEOUT_MS = 30000

/** 每类上下文（屏幕/摄像头）保留的最大帧数。 */
const MAX_CONTEXT_FRAMES = 3

/** 通知列表保留的最大条数。 */
const MAX_NOTIFICATIONS = 50

/** 已断开设备条目在内存中保留的时长。 */
const DISCONNECTED_RETENTION_MS = ms('1h')

/**
 * 设备上下文快照。
 * @typedef {object} DeviceContext
 * @property {object[]} screen - 最近的屏幕上下文（文字 / UI 树 / 截图）。
 * @property {{ front: object[], back: object[] }} camera - 最近的前后摄帧。
 * @property {object[]} notifications - 最近的设备通知。
 */

/**
 * 已连接（或最近连接过）的设备信息。
 * @typedef {object} DeviceInfo
 * @property {string} deviceId - 设备标识。
 * @property {import('npm:ws').WebSocket | null} ws - 当前连接，断开后为 null。
 * @property {string} name - 设备名。
 * @property {number} androidVersion - Android API 级别。
 * @property {string[]} capabilities - 设备自报能力。
 * @property {Date} connectedAt - 首次连接时间。
 * @property {Date | null} disconnectedAt - 断开时间。
 * @property {DeviceContext} context - 上下文快照。
 */

/**
 * 待响应请求记录。
 * @typedef {object} PendingRequest
 * @property {string} deviceId - 目标设备。
 * @property {(value: any) => void} resolve - 成功回调。
 * @property {(error: Error) => void} reject - 失败回调。
 */

/**
 * 按用户隔离的设备管理器。
 */
class UserDeviceManager {
	/**
	 * @param {string} username - 用户名。
	 */
	constructor(username) {
		this.username = username
		/**
		 * 该用户的全部设备。
		 * @type {Map<string, DeviceInfo>}
		 */
		this.devices = new Map()
		/**
		 * requestId → 待响应请求。
		 * @type {Map<string, PendingRequest>}
		 */
		this.pendingRequests = new Map()
	}

	/**
	 * 新建或恢复一台设备连接。
	 * @param {import('npm:ws').WebSocket} ws - WebSocket 连接。
	 * @param {object} hello - 握手负载。
	 * @returns {DeviceInfo} 设备信息。
	 */
	registerDevice(ws, hello) {
		const deviceId = String(hello?.deviceId || randomUUID())
		const existing = this.devices.get(deviceId)
		if (existing) {
			existing.ws = ws
			existing.disconnectedAt = null
			if (hello?.name) existing.name = hello.name
			if (hello?.androidVersion != null) existing.androidVersion = hello.androidVersion
			if (hello?.capabilities) existing.capabilities = hello.capabilities
			return existing
		}

		/**
		 * 新设备条目。
		 * @type {DeviceInfo}
		 */
		const device = {
			deviceId,
			ws,
			name: hello?.name || deviceId,
			androidVersion: hello?.androidVersion ?? 0,
			capabilities: hello?.capabilities || [],
			connectedAt: new Date(),
			disconnectedAt: null,
			context: { screen: [], camera: { front: [], back: [] }, notifications: [] }
		}
		this.devices.set(deviceId, device)
		return device
	}

	/**
	 * 标记设备断开，并失败其所有待响应请求。
	 * @param {string} deviceId - 设备标识。
	 */
	markDisconnected(deviceId) {
		const device = this.devices.get(deviceId)
		if (device) {
			device.ws = null
			device.disconnectedAt = new Date()
		}
		for (const [requestId, pending] of this.pendingRequests)
			if (pending.deviceId === deviceId) {
				this.pendingRequests.delete(requestId)
				pending.reject(new Error(`设备已断开: ${deviceId}`))
			}
	}

	/**
	 * 取一台已连接的设备，未连接则抛错。
	 * @param {string} deviceId - 设备标识。
	 * @returns {DeviceInfo} 设备信息。
	 */
	requireConnected(deviceId) {
		const device = this.devices.get(deviceId)
		if (!device || !device.ws || device.ws.readyState !== device.ws.OPEN)
			throw httpError(404, `设备未连接: ${deviceId}`)
		return device
	}

	/**
	 * 选择目标设备：给定 id 则用之，否则取最近连接的在线设备。
	 * @param {string | undefined} deviceId - 可选设备标识。
	 * @returns {DeviceInfo} 设备信息。
	 */
	pickDevice(deviceId) {
		if (deviceId) return this.requireConnected(deviceId)
		const connected = [...this.devices.values()].filter(d => d.ws)
		if (!connected.length) throw httpError(404, '没有已连接的手机设备')
		connected.sort((a, b) => b.connectedAt.getTime() - a.connectedAt.getTime())
		return connected[0]
	}

	/**
	 * 向设备发送一条命令并等待响应。
	 * @param {string} deviceId - 目标设备。
	 * @param {string} tool - 命令名（目前仅 eval）。
	 * @param {object} args - 命令参数。
	 * @param {number} timeoutMs - 超时。
	 * @returns {Promise<any>} 设备响应负载。
	 */
	sendRequest(deviceId, tool, args = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
		const device = this.requireConnected(deviceId)
		return new Promise((resolve, reject) => {
			const requestId = `${deviceId}-${randomUUID()}`
			this.pendingRequests.set(requestId, { deviceId, resolve, reject })
			setTimeout(() => {
				if (this.pendingRequests.has(requestId)) {
					this.pendingRequests.delete(requestId)
					reject(new Error(`设备响应超时（${timeoutMs}ms）: ${tool}`))
				}
			}, timeoutMs).unref?.()
			device.ws.send(JSON.stringify({ type: 'cmd', requestId, tool, args }))
		})
	}

	/**
	 * 结算一条设备响应。
	 * @param {string} requestId - 请求标识。
	 * @param {boolean} isError - 是否错误。
	 * @param {object} payload - 响应负载。
	 */
	settleRequest(requestId, isError, payload) {
		const pending = this.pendingRequests.get(requestId)
		if (!pending) return
		this.pendingRequests.delete(requestId)
		if (isError) pending.reject(new Error(payload?.error || '设备返回错误'))
		else pending.resolve(payload)
	}

	/**
	 * 处理设备上报的上下文。
	 * @param {string} deviceId - 设备标识。
	 * @param {object} message - 上下文消息。
	 */
	updateContext(deviceId, message) {
		const device = this.devices.get(deviceId)
		if (!device) return
		const payload = message.payload || {}
		if (message.kind === 'camera') {
			const facing = message.facing === 'front' ? 'front' : 'back'
			const list = device.context.camera[facing]
			list.push(payload)
			while (list.length > MAX_CONTEXT_FRAMES) list.shift()
			return
		}
		device.context.screen.push(payload)
		while (device.context.screen.length > MAX_CONTEXT_FRAMES) device.context.screen.shift()
	}

	/**
	 * 处理设备上报的事件（通知等）。
	 * @param {string} deviceId - 设备标识。
	 * @param {object} message - 事件消息。
	 */
	handleEvent(deviceId, message) {
		const device = this.devices.get(deviceId)
		if (!device) return
		if (message.event === 'notification') {
			device.context.notifications.push(message.payload || {})
			while (device.context.notifications.length > MAX_NOTIFICATIONS)
				device.context.notifications.shift()
		}
	}

	/**
	 * 清理长期断开的设备条目。
	 */
	cleanup() {
		const now = Date.now()
		for (const [deviceId, device] of this.devices)
			if (!device.ws && device.disconnectedAt && now - device.disconnectedAt.getTime() > DISCONNECTED_RETENTION_MS)
				this.devices.delete(deviceId)
	}

	/**
	 * 对外暴露的设备清单。
	 * @returns {object[]} 设备摘要列表。
	 */
	listDevices() {
		return [...this.devices.values()].map(device => ({
			deviceId: device.deviceId,
			name: device.name,
			androidVersion: device.androidVersion,
			capabilities: device.capabilities,
			connected: !!device.ws,
			connectedAt: device.connectedAt,
			disconnectedAt: device.disconnectedAt
		}))
	}

	/**
	 * 取设备上下文快照（仅文本层，二进制帧用 frame 接口单独取）。
	 * @param {string} deviceId - 设备标识。
	 * @returns {object} 上下文快照。
	 */
	state(deviceId) {
		const device = this.pickDevice(deviceId)
		const latestScreen = device.context.screen.at(-1) || null
		return {
			deviceId: device.deviceId,
			name: device.name,
			connected: !!device.ws,
			screen: latestScreen && { ...latestScreen, screenshot: latestScreen.screenshot ? '<omitted>' : undefined },
			screenFrameCount: device.context.screen.length,
			camera: {
				front: device.context.camera.front.length,
				back: device.context.camera.back.length
			},
			notifications: device.context.notifications.slice(-10)
		}
	}

	/**
	 * 取指定类别的最新一帧图片数据。
	 * @param {string} deviceId - 设备标识。
	 * @param {'screen' | 'front' | 'back'} kind - 帧类别。
	 * @returns {{ mimeType: string, base64: string, ts: number }} 帧数据。
	 */
	frame(deviceId, kind) {
		const device = this.pickDevice(deviceId)
		let frame = null
		if (kind === 'front' || kind === 'back') frame = device.context.camera[kind].at(-1) || null
		else frame = device.context.screen.at(-1) || null

		const base64 = kind === 'screen' ? frame?.screenshot : frame?.frame
		if (!base64) throw httpError(404, `尚无 ${kind} 帧`)
		return { mimeType: 'image/jpeg', base64, ts: frame.ts || 0 }
	}
}

// --- 全局状态 ---

/**
 * username → 设备管理器。
 * @type {Map<string, UserDeviceManager>}
 */
const userManagers = new Map()

/**
 * 取用户设备管理器。
 * @param {string} username - 用户名。
 * @returns {UserDeviceManager} 设备管理器。
 */
export function getUserManager(username) {
	if (!userManagers.has(username))
		userManagers.set(username, new UserDeviceManager(username))
	return userManagers.get(username)
}

// --- 周期清理 ---

setInterval(() => {
	for (const manager of userManagers.values()) manager.cleanup()
}, ms('5m')).unref()

/**
 * 处理一条来自安卓客户端的 WebSocket 连接。
 * @param {import('npm:ws').WebSocket} ws - WebSocket 连接。
 * @param {string} username - 用户名。
 */
export function handleConnection(ws, username) {
	const manager = getUserManager(username)
	let deviceId = null

	ws.on('message', message => {
		/** @type {any} */
		let data
		try {
			data = JSON.parse(message.toString('utf-8'))
		}
		catch (error) {
			console.error(`[phone] ${username} 发来的消息无法解析:`, error)
			return
		}
		if (!data || typeof data !== 'object') return

		switch (data.type) {
			case 'hello': {
				const device = manager.registerDevice(ws, data.payload)
				deviceId = device.deviceId
				ws.send(JSON.stringify({ type: 'hello_ok', payload: { username, deviceId } }))
				break
			}
			case 'response':
				manager.settleRequest(data.requestId, !!data.isError, data.payload)
				break
			case 'context':
				if (deviceId) manager.updateContext(deviceId, data)
				break
			case 'event':
				if (deviceId) manager.handleEvent(deviceId, data)
				break
			case 'assist':
				// 手机发起的对话（Gemini 式唤醒）留待后续。
				ws.send(JSON.stringify({
					type: 'assist_error',
					assistId: data.assistId,
					error: 'assist 流程尚未实现'
				}))
				break
			default:
				console.warn(`[phone] ${username}/${deviceId} 未知消息类型: ${data.type}`)
		}
	})

	ws.on('close', () => {
		if (deviceId) manager.markDisconnected(deviceId)
	})

	ws.on('error', error => {
		console.error(`[phone] ${username}/${deviceId} WebSocket 错误:`, error)
		ws.close()
	})
}

// --- 导出 API ---

/**
 * 列出用户的设备。
 * @param {string} username - 用户名。
 * @returns {object[]} 设备摘要列表。
 */
export function listDevices(username) {
	return getUserManager(username).listDevices()
}

/**
 * 取用户某设备的上下文快照。
 * @param {string} username - 用户名。
 * @param {string} [deviceId] - 设备标识。
 * @returns {object} 上下文快照。
 */
export function getState(username, deviceId) {
	return getUserManager(username).state(deviceId)
}

/**
 * 取设备最新一帧图片。
 * @param {string} username - 用户名。
 * @param {string} [deviceId] - 设备标识。
 * @param {'screen' | 'front' | 'back'} [kind] - 帧类别。
 * @returns {{ mimeType: string, base64: string, ts: number }} 帧数据。
 */
export function getFrame(username, deviceId, kind = 'screen') {
	return getUserManager(username).frame(deviceId, kind)
}

/**
 * 在设备上执行一段原始 Java 代码（由手机端编译执行）。
 * @param {string} username - 用户名。
 * @param {object} options - 执行选项。
 * @param {string} [options.deviceId] - 目标设备。
 * @param {string} [options.language] - 语言，目前仅 java。
 * @param {string} options.source - 源码。
 * @param {number} [options.timeoutMs] - 超时。
 * @param {string} [options.persist] - 持久化的 snippet 名。
 * @returns {Promise<object>} 执行结果。
 */
export function execOnDevice(username, { deviceId, language = 'java', source, timeoutMs, persist } = {}) {
	if (!source || typeof source !== 'string')
		throw httpError(400, '缺少 source')
	const manager = getUserManager(username)
	const device = manager.pickDevice(deviceId)
	const effectiveTimeout = timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
	return manager.sendRequest(device.deviceId, 'eval', {
		language,
		source,
		timeoutMs: effectiveTimeout,
		persist: persist || null
	}, effectiveTimeout + 5000)
}
