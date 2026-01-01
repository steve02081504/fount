// Handle Trystero connections and subfount management
import { randomUUID } from 'node:crypto'

import { events } from '../../../../../server/events.mjs'
import { loadPart } from '../../../../../server/parts_loader.mjs'
import { loadShellData } from '../../../../../server/setting_loader.mjs'

/**
 * @typedef {object} DeviceInfo
 * @property {string} hostname - 主机名
 * @property {object} os - 操作系统信息
 * @property {object} cpu - CPU 信息
 * @property {object} memory - 内存信息
 * @property {object} disk - 磁盘信息
 * @property {string} timestamp - 收集信息时的 ISO 时间戳
 */

/**
 * @typedef {object} SubfountInfo
 * @property {number} id - 分机 ID (0 为主机, >0 为远程)
 * @property {string} peerId - 对等端 ID (远程对等端的 ID)
 * @property {string} hostPeerId - 主机对等端 ID (此用户的房间 ID)
 * @property {Date} connectedAt - 连接时间
 * @property {Date|null} disconnectedAt - 断开连接时间
 * @property {boolean} isConnected - 当前是否已连接
 * @property {DeviceInfo|null} deviceInfo - 设备信息 (主机为 null)
 */

const pendingRequests = new Map()

/**
 * 获取 JSON.stringify 的循环引用替换器。
 * @returns {function(string, any): any} - 替换器函数。
 */
const getCircularReplacer = () => {
	const seen = new WeakSet()
	return (_key, value) => {
		if (value === Object(value)) {
			if (seen.has(value)) return '[Circular]'
			seen.add(value)
		}
		return value
	}
}

/**
 * 管理单个用户的所有分机连接。
 */
class UserSubfountManager {
	/**
	 * 创建 UserSubfountManager 实例。
	 * @param {string} username - 与此管理器关联的用户名。
	 * @param {string} hostPeerId - 此用户的主机对等端 ID。
	 */
	constructor(username, hostPeerId) {
		this.username = username
		this.hostPeerId = hostPeerId
		/**
		 * 分机 ID 到 SubfountInfo 的映射
		 * @type {Map<number, SubfountInfo>}
		 */
		this.subfounts = new Map()
		/**
		 * 分配给新远程分机的下一个 ID
		 * @type {number}
		 */
		this.nextSubfountId = 1
		/**
		 * UI WebSocket 连接集合
		 * @type {Set<import('npm:ws').WebSocket>}
		 */
		this.uiSockets = new Set()
		/**
		 * Trystero 房间实例
		 * @type {any}
		 */
		this.room = null
		/**
		 * 已认证对等端 ID 的集合
		 * @type {Set<string>}
		 */
		this.authenticatedPeers = new Set()
		/**
		 * 用于通信的操作函数
		 * @type {Map<string, Array<Function>>}
		 */
		this.actions = new Map()

		// 初始化主机分机 (id 0)
		this.subfounts.set(0, {
			id: 0,
			peerId: null,
			hostPeerId: null,
			connectedAt: new Date(),
			disconnectedAt: null,
			isConnected: true,
			deviceInfo: null, // 主机没有设备信息（它就是主机本身）
		})

		// 初始化 Trystero 房间
		this.initRoom()
	}

	/**
	 * 初始化 Trystero 房间。
	 */
	async initRoom() {
		try {
			// 离开现有房间（如果有）
			if (this.room) {
				this.room.leave()
				this.room = null
				this.actions.clear()
			}

			const { joinRoom } = await import('npm:trystero/mqtt')
			const { RTCPeerConnection } = await import('npm:node-datachannel/polyfill')
			const codesData = loadShellData(this.username, 'subfounts', 'connection_codes')
			const config = {
				appId: 'fount-subfounts',
				rtcPolyfill: RTCPeerConnection,
				password: codesData.password, // 使用连接密码进行加密
			}
			this.room = joinRoom(config, this.hostPeerId)

			// 设置操作处理程序
			const actionNames = ['authenticate', 'device_info', 'response', 'run_code', 'callback', 'shell_exec']
			for (const name of actionNames)
				this.actions.set(name, this.room.makeAction(name))

			const [sendAuth, getAuth] = this.actions.get('authenticate')
			const [, getDeviceInfo] = this.actions.get('device_info')
			const [, getResponse] = this.actions.get('response')
			const [, getCallback] = this.actions.get('callback')
			const [, getShellExec] = this.actions.get('shell_exec')

			// 处理对等端加入
			this.room.onPeerJoin(() => {
				// 等待身份验证后再处理消息
			})

			// 处理对等端离开
			this.room.onPeerLeave((peerId) => {
				this.authenticatedPeers.delete(peerId)
				const subfount = this.getSubfountByRemotePeerId(peerId)
				if (subfount) {
					subfount.isConnected = false
					subfount.disconnectedAt = new Date()
					this.broadcastUiUpdate()
				}
			})

			// 处理身份验证消息
			getAuth((data, peerId) => {
				if (this.authenticatedPeers.has(peerId)) return

				const codesData = loadShellData(this.username, 'subfounts', 'connection_codes')
				const receivedPassword = data?.password || data
				if (codesData.password === receivedPassword) {
					this.authenticatedPeers.add(peerId)
					let subfount = this.getSubfountByRemotePeerId(peerId)
					if (!subfount)
						subfount = this.addSubfount(peerId)
					else {
						subfount.isConnected = true
						subfount.disconnectedAt = null
					}
					this.broadcastUiUpdate()
					sendAuth({ type: 'authenticated' }, peerId)
				}
				else
					sendAuth({ type: 'auth_error', error: 'Invalid password' }, peerId)
			})

			// 处理设备信息消息
			getDeviceInfo((data, peerId) => {
				if (!this.authenticatedPeers.has(peerId)) return
				const subfount = this.getSubfountByRemotePeerId(peerId)
				if (subfount)
					this.updateDeviceInfo(subfount.id, data)

			})

			// 处理响应消息
			getResponse((data, peerId) => {
				if (!this.authenticatedPeers.has(peerId)) return
				if (!data.requestId) return
				const pending = pendingRequests.get(data.requestId)
				if (pending) {
					pendingRequests.delete(data.requestId)
					if (data.isError)
						pending.reject(new Error(data.payload?.error || data.payload || 'Unknown error'))
					else
						pending.resolve(data.payload)
				}
			})

			// 处理回调消息
			getCallback((data, peerId) => {
				if (!this.authenticatedPeers.has(peerId)) return
				this.handleCallback(data)
			})

			// 处理 shell 执行消息（注：虽然 makeAction 在循环中创建了，但这里显式获取并设置处理程序以保持逻辑清晰）
			getShellExec((data, peerId) => {
				if (!this.authenticatedPeers.has(peerId)) return
				if (!data.requestId) return
				const pending = pendingRequests.get(data.requestId)
				if (pending) {
					pendingRequests.delete(data.requestId)
					if (data.isError)
						pending.reject(new Error(data.payload?.error || data.payload || 'Unknown error'))
					else
						pending.resolve(data.payload)
				}
			})

		}
		catch (error) {
			console.error(`Failed to initialize Trystero room for user ${this.username}:`, error)
		}
	}

	/**
	 * 处理来自分机的回调。
	 * @param {object} payload - 回调载荷。
	 */
	async handleCallback(payload) {
		const { partpath, data } = payload
		const normalizedPartpath = partpath.replace(/^\/+|\/+$/g, '')
		const part = await loadPart(this.username, normalizedPartpath)
		if (part.interfaces?.subfount?.RemoteCallBack)
			await part.interfaces.subfount.RemoteCallBack({ data, username: this.username, partpath })
	}

	/**
	 * 通过远程对等端 ID 获取分机。
	 * @param {string} remotePeerId - 远程对等端 ID。
	 * @returns {SubfountInfo | undefined} - 分机信息对象。
	 */
	getSubfountByRemotePeerId(remotePeerId) {
		return Array.from(this.subfounts.values()).find(s => s.peerId === remotePeerId)
	}

	/**
	 * 注册新的 UI WebSocket 连接以接收更新。
	 * @param {import('npm:ws').WebSocket} ws - 要注册的 WebSocket 连接。
	 */
	registerUi(ws) {
		this.uiSockets.add(ws)

		// 发送初始状态
		ws.send(JSON.stringify({
			type: 'subfounts_update',
			payload: this.getConnectedSubfounts()
		}))

		ws.on('close', () => {
			this.uiSockets.delete(ws)
		})
	}

	/**
	 * 向所有注册的 UI 连接广播当前分机状态更新。
	 */
	broadcastUiUpdate() {
		if (!this.uiSockets.size) return

		const payload = {
			type: 'subfounts_update',
			payload: this.getConnectedSubfounts()
		}
		const message = JSON.stringify(payload)

		for (const ws of this.uiSockets)
			if (ws.readyState === ws.OPEN)
				ws.send(message)
	}

	/**
	 * 添加新的远程分机连接。
	 * @param {string} peerId - 对等端 ID。
	 * @returns {SubfountInfo} - 创建的分机信息对象。
	 */
	addSubfount(peerId) {
		const id = this.nextSubfountId++
		const subfount = {
			id,
			peerId,
			connectedAt: new Date(),
			disconnectedAt: null,
			isConnected: true,
			deviceInfo: null,
		}

		this.subfounts.set(id, subfount)
		this.broadcastUiUpdate()
		return subfount
	}

	/**
	 * 更新分机的设备信息。
	 * @param {number} id - 分机 ID。
	 * @param {DeviceInfo} deviceInfo - 设备信息。
	 */
	updateDeviceInfo(id, deviceInfo) {
		const subfount = this.subfounts.get(id)
		if (subfount) {
			subfount.deviceInfo = deviceInfo
			this.broadcastUiUpdate()
		}
	}

	/**
	 * 按 ID 移除分机。
	 * @param {number} id - 要移除的分机 ID。
	 */
	removeSubfount(id) {
		if (id === 0) return // 不能移除主机

		const subfount = this.subfounts.get(id)
		if (subfount) {
			subfount.disconnectedAt = new Date()
			subfount.isConnected = false
			this.broadcastUiUpdate()
		}
	}

	/**
	 * 获取分机信息。
	 * @param {number} id - 分机 ID。
	 * @returns {SubfountInfo | undefined} - 分机信息对象。
	 */
	getSubfount(id) {
		return this.subfounts.get(id)
	}

	/**
	 * 获取所有已连接的分机。
	 * @returns {Array<object>} - 已连接分机信息对象的数组。
	 */
	getConnectedSubfounts() {
		return Array.from(this.subfounts.values())
			.filter(s => s.id === 0 || s.isConnected)
			.map(s => ({
				id: s.id,
				peerId: s.peerId,
				connectedAt: s.connectedAt,
				deviceInfo: s.deviceInfo,
				isConnected: s.id === 0 || s.isConnected,
			}))
	}

	/**
	 * 获取所有分机（包括已断开连接的）。
	 * @returns {Array<object>} - 所有分机信息对象的数组。
	 */
	getAllSubfounts() {
		return Array.from(this.subfounts.values()).map(s => ({
			id: s.id,
			peerId: s.peerId,
			connectedAt: s.connectedAt,
			disconnectedAt: s.disconnectedAt,
			isConnected: s.isConnected,
			deviceInfo: s.deviceInfo,
		}))
	}

	/**
	 * 向分机发送请求并等待响应。
	 * 对于远程分机，这将使用 Trystero 房间操作。
	 * @param {number} subfountId - 目标分机 ID。
	 * @param {object} command - 要发送的命令对象。
	 * @returns {Promise<any>} - 解析为分机响应的 Promise。
	 */
	sendRequest(subfountId, command) {
		return new Promise((resolve, reject) => {
			const subfount = this.subfounts.get(subfountId)
			if (!subfount || !subfount.isConnected)
				return reject(new Error(`Subfount ${subfountId} not connected.`))

			// 主机分机 (id 0) - 本地执行
			if (subfountId === 0) {
				if (command.type === 'shell_exec')
					this.executeLocalShell(command.payload.command, command.payload.shell, command.payload.options)
						.then(resolve).catch(reject)
				else
					this.executeLocalCode(command.payload.script, command.payload.callbackInfo)
						.then(resolve).catch(reject)
				return
			}

			// 远程分机 - 使用 Trystero 房间
			const requestId = `${subfountId}-${randomUUID()}`
			pendingRequests.set(requestId, { resolve, reject })

			setTimeout(() => {
				if (pendingRequests.has(requestId)) {
					pendingRequests.delete(requestId)
					reject(new Error('Request timed out after 30 seconds.'))
				}
			}, 30000)

			// 使用 Trystero 操作发送命令
			const actionName = command.type === 'shell_exec' ? 'shell_exec' : 'run_code'
			const [sendAction] = this.actions.get(actionName)
			sendAction({ ...command, requestId }, subfount.peerId).catch((error) => {
				pendingRequests.delete(requestId)
				reject(new Error(`Failed to send request: ${error.message}`))
			})
		})
	}

	/**
	 * 本地执行代码（用于主机分机）。
	 * @param {string} script - 要执行的 JavaScript 代码。
	 * @param {object} callbackInfo - 远程调用的回调信息。
	 * @returns {Promise<any>} - 执行结果。
	 */
	async executeLocalCode(script, callbackInfo = null) {
		const { async_eval } = await import('https://cdn.jsdelivr.net/gh/steve02081504/async-eval/deno.mjs')

		let callback = null
		if (callbackInfo)
			/**
			 * 远程回调函数。
			 * @param {any} data - 回调数据。
			 */
			callback = async (data) => {
				const { username, partpath } = callbackInfo
				const normalizedPartpath = partpath.replace(/^\/+|\/+$/g, '')
				const part = await loadPart(username, normalizedPartpath)
				if (part.interfaces?.subfount?.RemoteCallBack)
					await part.interfaces.subfount.RemoteCallBack({ data, username, partpath })
			}


		const evalResult = await async_eval(script, { callback })

		return JSON.parse(JSON.stringify(evalResult, getCircularReplacer()))
	}

	/**
	 * 本地执行 shell 命令（用于主机分机）。
	 * @param {string} command - 要执行的 shell 命令。
	 * @param {string|null} shell - Shell 类型（'pwsh'、'powershell'、'bash'、'sh' 或 null 表示默认）。
	 * @param {object} options - 执行选项。
	 * @returns {Promise<any>} - 执行结果。
	 */
	async executeLocalShell(command, shell = null, options = {}) {
		const { exec, powershell_exec, bash_exec, sh_exec, pwsh_exec, shell_exec_map } = await import('npm:@steve02081504/exec')

		// 确定要使用的 exec 函数
		let execFunction = exec
		if (shell)
			if (shell_exec_map[shell])
				execFunction = shell_exec_map[shell]
			else
				throw new Error(`Unsupported shell: ${shell}`)

		// 执行命令
		return await execFunction(command, options)
	}
}

// --- 全局状态 ---
// Map<username, UserSubfountManager>
const userManagers = new Map()

// 清理事件处理程序
events.on('BeforeUserDeleted', ({ username }) => {
	const manager = userManagers.get(username)
	if (manager) {
		// 离开 Trystero 房间
		if (manager.room)
			manager.room.leave()

		// 关闭所有 UI WebSocket 连接
		for (const ws of manager.uiSockets)
			if (ws.readyState === ws.OPEN)
				ws.close()

		// 从映射中移除管理器
		userManagers.delete(username)
	}
})

events.on('BeforeUserRenamed', ({ oldUsername, newUsername }) => {
	const manager = userManagers.get(oldUsername)
	if (manager) {
		// 更新管理器中的用户名
		manager.username = newUsername
		// 将管理器移动到新用户名键
		userManagers.set(newUsername, manager)
		userManagers.delete(oldUsername)
	}
})

/**
 * 获取用户分机管理器。
 * @param {string} username - 用户名。
 * @param {string} hostPeerId - 主机对等端 ID（可选，如果未提供将生成）。
 * @returns {UserSubfountManager} - 用户分机管理器。
 */
export function getUserManager(username, hostPeerId = null) {
	const existing = userManagers.get(username)

	// 如果提供了 hostPeerId 且与现有的不同，则重新创建管理器
	if (hostPeerId && existing && existing.hostPeerId !== hostPeerId) {
		// 离开旧房间
		if (existing.room)
			existing.room.leave()

		// 移除旧管理器
		userManagers.delete(username)
		// 创建带有新对等端 ID 的新管理器
		const newManager = new UserSubfountManager(username, hostPeerId)
		userManagers.set(username, newManager)
		return newManager
	}

	// 如果不存在管理器，则创建一个
	if (!existing) {
		// 如果未提供 hostPeerId，尝试从持久存储加载
		if (!hostPeerId) {
			const codesData = loadShellData(username, 'subfounts', 'connection_codes')
			if (codesData.peerId)
				hostPeerId = codesData.peerId
			else
				// 生成临时 ID - 这应该被实际连接代码替换
				hostPeerId = `temp-${randomUUID()}`
		}

		const newManager = new UserSubfountManager(username, hostPeerId)
		userManagers.set(username, newManager)
		return newManager
	}

	// 确保现有管理器已初始化房间
	if (!existing.room)
		existing.initRoom()

	return existing
}

/**
 * 在分机上执行代码。
 * @param {string} username - 用户名。
 * @param {number} subfountId - 分机 ID。
 * @param {string} script - 要执行的 JavaScript 代码。
 * @param {object} callbackInfo - 回调信息。
 * @param {string|null} hostPeerId - 主机对等端 ID（可选）。
 * @returns {Promise<any>} - 执行结果。
 */
export async function executeCodeOnSubfount(username, subfountId, script, callbackInfo = null, hostPeerId = null) {
	const manager = hostPeerId ? getUserManager(username, hostPeerId) : userManagers.get(username)
	if (!manager)
		throw new Error(`No manager found for user ${username}`)

	return await manager.sendRequest(subfountId, {
		type: 'run_code',
		payload: { script, callbackInfo }
	})
}

/**
 * 获取用户的所有分机。
 * @param {string} username - 用户名。
 * @returns {Array<object>} - 分机信息对象的数组。
 */
export function getAllSubfounts(username) {
	const manager = userManagers.get(username)
	if (!manager) return []
	return manager.getAllSubfounts()
}

/**
 * 获取用户的已连接分机。
 * @param {string} username - 用户名。
 * @returns {Array<object>} - 已连接分机信息对象的数组。
 */
export function getConnectedSubfounts(username) {
	const manager = userManagers.get(username)
	if (!manager) return []
	return manager.getConnectedSubfounts()
}

/**
 * 在分机上执行 shell 命令。
 * @param {string} username - 用户名。
 * @param {number} subfountId - 分机 ID。
 * @param {string} command - 要执行的 shell 命令。
 * @param {string|null} shell - Shell 类型（'pwsh'、'powershell'、'bash'、'sh' 或 null 表示默认）。
 * @param {object} options - 执行选项。
 * @param {string|null} hostPeerId - 主机对等端 ID（可选）。
 * @returns {Promise<any>} - 执行结果。
 */
export async function executeShellOnSubfount(username, subfountId, command, shell = null, options = {}, hostPeerId = null) {
	const manager = hostPeerId ? getUserManager(username, hostPeerId) : userManagers.get(username)
	if (!manager)
		throw new Error(`No manager found for user ${username}`)

	return await manager.sendRequest(subfountId, {
		type: 'shell_exec',
		payload: { command, shell, options }
	})
}
