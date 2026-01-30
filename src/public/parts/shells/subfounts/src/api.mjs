import { randomUUID } from 'node:crypto'
import { deserialize } from 'node:v8'

import { events } from '../../../../../server/events.mjs'
import { loadPart } from '../../../../../server/parts_loader.mjs'
import { loadShellData, saveShellData } from '../../../../../server/setting_loader.mjs'

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
 * @property {number} id - 分机 ID
 * @property {string|null} peerId - 对等端 ID (远程对等端的 ID，本地为 null)
 * @property {string|null} hostPeerId - 主机对等端 ID (此用户的房间 ID，本地为 null)
 * @property {Date} connectedAt - 连接时间
 * @property {Date|null} disconnectedAt - 断开连接时间
 * @property {boolean} isConnected - 当前是否已连接
 * @property {DeviceInfo|null} deviceInfo - 设备信息 (本地为 null)
 * @property {string|null} description - 设备备注 (用户设置的友好描述)
 * @property {string} deviceId - 设备 ID (本机为 'localhost'，远程设备为机器 ID 或 id 的字符串形式)
 * @property {SubfountExecutor} executor - 执行器实例
 */

/**
 * 分机执行器基类，定义统一的执行接口。
 */
class SubfountExecutor {
	/**
	 * 执行命令（代码或 shell）。
	 * @param {object} command - 命令对象。
	 * @returns {Promise<any>} - 执行结果。
	 */
	async execute(command) { throw new Error() }
}

/**
 * 本地执行器，用于主机分机。
 */
class LocalSubfountExecutor extends SubfountExecutor {
	/**
	 * 创建本地执行器。
	 * @param {string} username - 用户名。
	 */
	constructor(username) {
		super()
		this.username = username
	}

	/**
	 * 执行命令（代码或 shell）。
	 * @param {object} command - 命令对象。
	 * @returns {Promise<any>} - 执行结果。
	 */
	async execute(command) {
		if (command.type === 'shell_exec')
			return await this.executeShell(
				command.payload.command,
				command.payload.shell,
				command.payload.options
			)
		else
			return await this.executeCode(
				command.payload.script,
				command.payload.callbackInfo
			)
	}

	/**
	 * 执行代码。
	 * @param {string} script - 要执行的 JavaScript 代码。
	 * @param {object} callbackInfo - 远程调用的回调信息。
	 * @returns {Promise<any>} - 执行结果。
	 */
	async executeCode(script, callbackInfo = null) {
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

		return evalResult
	}

	/**
	 * 执行 shell 命令。
	 * @param {string} command - 要执行的 shell 命令。
	 * @param {string|null} shell - Shell 类型（'pwsh'、'powershell'、'bash'、'sh' 或 null 表示默认）。
	 * @param {object} options - 执行选项。
	 * @returns {Promise<any>} - 执行结果。
	 */
	async executeShell(command, shell = null, options = {}) {
		const { exec, shell_exec_map } = await import('npm:@steve02081504/exec')

		// 确定要使用的 exec 函数
		if (shell) {
			if (!shell_exec_map[shell])
				throw new Error(`Unsupported shell: ${shell}`)
			return await shell_exec_map[shell](command, options)
		}
		return await exec(command, options)
	}
}

/**
 * 远程执行器，用于远程分机。
 */
class RemoteSubfountExecutor extends SubfountExecutor {
	/**
	 * 创建远程执行器。
	 * @param {UserSubfountManager} manager - 用户分机管理器。
	 * @param {number} subfountId - 分机 ID。
	 * @param {string} peerId - 对等端 ID。
	 */
	constructor(manager, subfountId, peerId) {
		super()
		this.manager = manager
		this.subfountId = subfountId
		this.peerId = peerId
	}

	/**
	 * 执行命令（代码或 shell）。
	 * @param {object} command - 命令对象。
	 * @returns {Promise<any>} - 执行结果。
	 */
	execute(command) {
		return new Promise((resolve, reject) => {
			const requestId = `${this.subfountId}-${randomUUID()}`
			this.manager.pendingRequests.set(requestId, { resolve, reject })

			setTimeout(() => {
				if (this.manager.pendingRequests.has(requestId)) {
					this.manager.pendingRequests.delete(requestId)
					reject(new Error('Request timed out after 30 seconds.'))
				}
			}, 30000)

			// 使用 Trystero 操作发送命令
			const actionName = command.type === 'shell_exec' ? 'shell_exec' : 'run_code'
			const [sendAction] = this.manager.actions.get(actionName)
			sendAction({ ...command, requestId }, this.peerId).catch((error) => {
				this.manager.pendingRequests.delete(requestId)
				reject(new Error(`Failed to send request: ${error.message}`))
			})
		})
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
		/**
		 * 待处理的请求映射（requestId -> { resolve, reject }）
		 * @type {Map<string, {resolve: Function, reject: Function}>}
		 */
		this.pendingRequests = new Map()

		// 加载设备备注
		this.deviceDescriptions = this.loadDeviceDescriptions()

		// 初始化主机分机 (id 0)
		const hostDescription = this.deviceDescriptions.get(0) || 'localhost'
		this.subfounts.set(0, {
			id: 0,
			deviceId: 'localhost',
			peerId: null,
			hostPeerId: null,
			connectedAt: new Date(),
			disconnectedAt: null,
			isConnected: true,
			deviceInfo: null,
			description: hostDescription,
			executor: new LocalSubfountExecutor(this.username),
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

			// 处理对等端离开
			this.room.onPeerLeave((peerId) => {
				this.authenticatedPeers.delete(peerId)
				const subfount = this.getSubfountByRemotePeerId(peerId)
				if (subfount) {
					subfount.isConnected = false
					subfount.disconnectedAt = new Date()
					subfount.peerId = null
					this.broadcastUiUpdate()
				}
			})

			// 处理身份验证消息
			getAuth((data, peerId) => {
				if (this.authenticatedPeers.has(peerId)) return

				const codesData = loadShellData(this.username, 'subfounts', 'connection_codes')
				const receivedPassword = data?.password || data
				const remoteDeviceId = data.deviceId || null

				if (codesData.password !== receivedPassword) {
					sendAuth({ type: 'auth_error', error: 'Invalid password' }, peerId)
					return
				}

				this.authenticatedPeers.add(peerId)

				// 使用设备 ID 或 peerId 来查找或创建分机
				let subfount = remoteDeviceId
					? this.getSubfountByDeviceId(remoteDeviceId)
					: this.getSubfountByRemotePeerId(peerId)

				if (subfount)
					// 更新现有分机
					this.updateSubfountConnection(subfount, peerId, remoteDeviceId)

				else
					// 创建新分机
					subfount = this.addSubfount(peerId, remoteDeviceId)


				this.broadcastUiUpdate()
				sendAuth({ type: 'authenticated' }, peerId)
			})

			// 处理设备信息消息
			getDeviceInfo((data, peerId) => {
				if (!this.authenticatedPeers.has(peerId)) return
				const subfount = this.getSubfountByRemotePeerId(peerId)
				if (subfount) this.updateDeviceInfo(subfount.id, data)
			})

			// 处理响应消息的通用函数
			/**
			 * 处理响应消息。
			 * @param {object} data - 响应数据。
			 * @param {string} peerId - 对等端 ID。
			 */
			const handleResponse = (data, peerId) => {
				if (!this.authenticatedPeers.has(peerId) || !data.requestId) return
				const pending = this.pendingRequests.get(data.requestId)
				if (pending) {
					this.pendingRequests.delete(data.requestId)
					if (data.isError)
						pending.reject(new Error(data.payload?.error || data.payload || 'Unknown error'))
					else
						pending.resolve(deserialize(data.payload))
				}
			}

			// 处理响应和 shell 执行消息
			getResponse(handleResponse)
			getShellExec(handleResponse)

			// 处理回调消息
			getCallback((data, peerId) => {
				if (!this.authenticatedPeers.has(peerId)) return
				this.handleCallback(data)
			})

		}
		catch (error) {
			console.error(`Failed to initialize Trystero room for user ${this.username}:`, error)
		}
	}

	/**
	 * 加载设备备注。
	 * @returns {Map<number, string>} - 设备 ID 到备注的映射。
	 */
	loadDeviceDescriptions() {
		const descriptionsData = loadShellData(this.username, 'subfounts', 'device_descriptions')
		const descriptionsMap = new Map()
		for (const [key, value] of Object.entries(descriptionsData)) {
			const id = parseInt(key, 10)
			if (!isNaN(id))
				descriptionsMap.set(id, value)
		}
		return descriptionsMap
	}

	/**
	 * 保存设备备注。
	 */
	saveDeviceDescriptions() {
		const descriptionsData = {}
		for (const [id, description] of this.deviceDescriptions.entries())
			descriptionsData[id.toString()] = description
		saveShellData(this.username, 'subfounts', 'device_descriptions')
	}

	/**
	 * 设置设备备注。
	 * @param {number} id - 设备 ID。
	 * @param {string|null} description - 设备备注（null 表示删除备注）。
	 */
	setDeviceDescription(id, description) {
		if (!description)
			this.deviceDescriptions.delete(id)
		else
			this.deviceDescriptions.set(id, description.trim())

		this.saveDeviceDescriptions()

		const subfount = this.subfounts.get(id)
		if (subfount) {
			subfount.description = this.deviceDescriptions.get(id) || null
			this.broadcastUiUpdate()
		}
	}

	/**
	 * 获取设备备注。
	 * @param {number} id - 设备 ID。
	 * @returns {string|null} - 设备备注。
	 */
	getDeviceDescription(id) {
		return this.deviceDescriptions.get(id) || null
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
			await part.interfaces.subfount.RemoteCallBack({ data: deserialize(data), username: this.username, partpath })
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
	 * 通过设备 ID 获取分机。
	 * @param {string} deviceId - 设备 ID。
	 * @returns {SubfountInfo | undefined} - 分机信息对象。
	 */
	getSubfountByDeviceId(deviceId) {
		return Array.from(this.subfounts.values()).find(s => s.deviceId === deviceId)
	}

	/**
	 * 更新分机的连接状态。
	 * @param {SubfountInfo} subfount - 分机信息对象。
	 * @param {string} peerId - 对等端 ID。
	 * @param {string|null} deviceId - 设备 ID（可选）。
	 */
	updateSubfountConnection(subfount, peerId, deviceId = null) {
		subfount.peerId = peerId
		subfount.isConnected = true
		if (deviceId) subfount.deviceId = deviceId
		if (subfount.disconnectedAt) {
			subfount.connectedAt = new Date()
			subfount.disconnectedAt = null
		}
		if (subfount.executor instanceof RemoteSubfountExecutor)
			subfount.executor.peerId = peerId
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
	 * @param {string|null} deviceId - 设备 ID（可选，远程设备的机器 ID）。
	 * @returns {SubfountInfo} - 创建或更新的分机信息对象。
	 */
	addSubfount(peerId, deviceId = null) {
		// 如果提供了设备 ID，尝试查找已存在的分机
		if (deviceId) {
			const existing = this.getSubfountByDeviceId(deviceId)
			if (existing) {
				// 更新现有分机
				this.updateSubfountConnection(existing, peerId, deviceId)
				this.broadcastUiUpdate()
				return existing
			}
		}

		// 创建新的分机
		const id = this.nextSubfountId++
		const description = this.deviceDescriptions.get(id) || null
		const subfount = {
			id,
			deviceId: deviceId || id.toString(),
			peerId,
			connectedAt: new Date(),
			disconnectedAt: null,
			isConnected: true,
			deviceInfo: null,
			description,
			executor: new RemoteSubfountExecutor(this, id, peerId),
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
		const subfount = this.subfounts.get(id)
		if (!subfount) return

		// 本地分机不能被移除
		if (subfount.executor instanceof LocalSubfountExecutor) return

		subfount.disconnectedAt = new Date()
		subfount.isConnected = false
		this.broadcastUiUpdate()
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
			.filter(s => s.isConnected)
			.map(s => ({
				id: s.id,
				deviceId: s.deviceId,
				peerId: s.peerId,
				connectedAt: s.connectedAt,
				deviceInfo: s.deviceInfo,
				isConnected: s.isConnected,
				description: s.description,
			}))
	}

	/**
	 * 获取所有分机（包括已断开连接的）。
	 * @returns {Array<object>} - 所有分机信息对象的数组。
	 */
	getAllSubfounts() {
		return Array.from(this.subfounts.values()).map(s => ({
			id: s.id,
			deviceId: s.deviceId,
			peerId: s.peerId,
			connectedAt: s.connectedAt,
			disconnectedAt: s.disconnectedAt,
			isConnected: s.isConnected,
			deviceInfo: s.deviceInfo,
			description: s.description,
		}))
	}

	/**
	 * 向分机发送请求并等待响应。
	 * @param {number} subfountId - 目标分机 ID。
	 * @param {object} command - 要发送的命令对象。
	 * @returns {Promise<any>} - 解析为分机响应的 Promise。
	 */
	sendRequest(subfountId, command) {
		const subfount = this.subfounts.get(subfountId)
		if (!subfount || !subfount.isConnected)
			return Promise.reject(new Error(`Subfount ${subfountId} not connected.`))

		return subfount.executor.execute(command)
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
	let existing = userManagers.get(username)

	// 如果传入了 hostPeerId 且与现有不符，直接清理旧的
	if (hostPeerId && existing && existing.hostPeerId !== hostPeerId) {
		if (existing.room)
			existing.room.leave()
		userManagers.delete(username)
		existing = null
	}

	// 如果不存在管理器，则创建一个
	if (!existing) {
		// 如果未提供 hostPeerId，尝试从持久存储加载
		if (!hostPeerId) {
			const codesData = loadShellData(username, 'subfounts', 'connection_codes')
			hostPeerId = codesData.peerId || `temp-${randomUUID()}`
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
 * @param {string|Function} script - 要执行的 JavaScript 代码或独立的函数/无外界引用的闭包。
 * @param {object} callbackInfo - 回调信息。
 * @param {string|null} hostPeerId - 主机对等端 ID（可选）。
 * @returns {Promise<any>} - 执行结果。
 * @example
 * // 推荐做法，便于lint检查
 * executeCodeOnSubfount('username', 1, () => {
 * 	const robotjs = await import('npm:robotjs')
 * 	return { width: robotjs.screen.width(), height: robotjs.screen.height() }
 * })
 * @example
 * executeCodeOnSubfount('username', 1, `\
 * import { screen } from 'npm:robotjs'
 * return { width: screen.width(), height: screen.height() }
 * `)
 */
export async function executeCodeOnSubfount(username, subfountId, script, callbackInfo = null, hostPeerId = null) {
	const manager = hostPeerId ? getUserManager(username, hostPeerId) : userManagers.get(username)
	if (!manager) throw new Error(`No manager found for user ${username}`)
	if (script instanceof Function) script = `(${script})()`

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

/**
 * 设置设备备注。
 * @param {string} username - 用户名。
 * @param {number} deviceId - 设备 ID。
 * @param {string|null} description - 设备备注（null 表示删除备注）。
 */
export function setDeviceDescription(username, deviceId, description) {
	const manager = userManagers.get(username)
	if (!manager)
		throw new Error(`No manager found for user ${username}`)

	manager.setDeviceDescription(deviceId, description)
}
