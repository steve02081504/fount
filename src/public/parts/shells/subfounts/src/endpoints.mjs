import crypto from 'node:crypto'

import { authenticate, getUserByReq } from '../../../../../server/auth.mjs'
import { loadShellData, saveShellData } from '../../../../../server/setting_loader.mjs'

import {
	getUserManager,
	getAllSubfounts,
	getConnectedSubfounts,
	executeCodeOnSubfount,
	executeShellOnSubfount,
	setDeviceDescription
} from './api.mjs'

/**
 * 获取用户的连接代码数据（从持久存储中）。
 * @param {string} username - 用户名。
 * @returns {object} - 连接代码数据对象。
 */
function getConnectionCodesData(username) {
	return loadShellData(username, 'subfounts', 'connection_codes')
}

/**
 * 为用户生成连接代码（房间 ID）和密码。
 * @param {string} username - 用户名。
 * @returns {{peerId: string, password: string}} - 连接代码（房间 ID）和密码。
 */
function generateConnectionCode(username) {
	const peerId = 'fountHost-' + crypto.randomBytes(16).toString('base64url').slice(0, 8)
	const password = crypto.randomBytes(8).toString('base64url').slice(0, 12)
	const codesData = getConnectionCodesData(username)
	codesData.peerId = peerId
	codesData.password = password
	saveShellData(username, 'subfounts', 'connection_codes')
	return { peerId, password }
}

/**
 * 获取用户的当前连接代码（如果不存在则创建）。
 * @param {string} username - 用户名。
 * @returns {{peerId: string, password: string}} - 连接代码和密码。
 */
function getConnectionCode(username) {
	const codesData = getConnectionCodesData(username)
	if (codesData.peerId && codesData.password)
		return { peerId: codesData.peerId, password: codesData.password }
	return generateConnectionCode(username)
}

/**
 * 设置 subfounts shell 的 API 端点。
 * @param {object} router - Express router 实例。
 */
export async function setEndpoints(router) {
	// 用于 UI 更新的 WebSocket
	router.ws('/ws/parts/shells:subfounts/ui', authenticate, async (ws, req) => {
		const { username } = await getUserByReq(req)
		const { peerId } = getConnectionCode(username)
		const manager = getUserManager(username, peerId)
		manager.registerUi(ws)
	})

	// 获取主机连接代码和密码
	router.get('/api/parts/shells:subfounts/connection-code', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { peerId, password } = getConnectionCode(username)
		// 确保存在具有此房间 ID 的管理器（房间在 getUserManager 中自动初始化）
		getUserManager(username, peerId)
		res.json({ peerId, password })
	})

	// 重新生成连接代码
	router.post('/api/parts/shells:subfounts/regenerate-code', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { peerId, password } = generateConnectionCode(username)
		// 使用新房间 ID 更新管理器（这将重新创建 Trystero 房间）
		getUserManager(username, peerId)
		res.json({ peerId, password })
	})

	// 列出所有分机
	router.get('/api/parts/shells:subfounts/list', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const subfounts = getAllSubfounts(username)
		res.json({ success: true, subfounts })
	})

	// 获取已连接的分机
	router.get('/api/parts/shells:subfounts/connected', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const subfounts = getConnectedSubfounts(username)
		res.json({ success: true, subfounts })
	})

	// 在分机上执行代码
	router.post('/api/parts/shells:subfounts/execute', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { subfountId, script, callbackInfo } = req.body

		if (subfountId === undefined) return res.status(400).json({ error: 'subfountId is required.' })
		if (!script) return res.status(400).json({ error: 'script is required.' })

		const { peerId } = getConnectionCode(username)
		const result = await executeCodeOnSubfount(username, subfountId, script, callbackInfo, peerId)
		res.json({ success: true, result })
	})

	// 在分机上执行 shell 命令
	router.post('/api/parts/shells:subfounts/execute-shell', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { subfountId, command, shell, options } = req.body

		if (subfountId === undefined) return res.status(400).json({ error: 'subfountId is required.' })
		if (!command) return res.status(400).json({ error: 'command is required.' })

		const { peerId } = getConnectionCode(username)
		const result = await executeShellOnSubfount(username, subfountId, command, shell || null, options || {}, peerId)
		res.json({ success: true, result })
	})

	// 获取分机信息，包括 shell 可用性
	router.get('/api/parts/shells:subfounts/info', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const subfounts = getConnectedSubfounts(username)

		// 获取主机 (subfount 0) 的 shell 可用性
		let hostShells = null
		try {
			const { available } = await import('npm:@steve02081504/exec')
			hostShells = {
				pwsh: available.pwsh,
				powershell: available.powershell,
				bash: available.bash,
				sh: available.sh,
			}
		}
		catch (error) {
			hostShells = { error: error.message }
		}

		// 映射带有 shell 可用性的分机
		const subfountsWithShells = subfounts.map(subfount => ({
			...subfount,
			shells: subfount.id === 0 ? hostShells : subfount.deviceInfo?.shells || null,
		}))

		res.json({ success: true, subfounts: subfountsWithShells })
	})

	// 设置设备备注
	router.post('/api/parts/shells:subfounts/set-description', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { deviceId, description } = req.body

		if (!deviceId) return res.status(400).json({ error: 'deviceId is required.' })

		setDeviceDescription(username, deviceId, description || null)
		res.json({ success: true })
	})
}
