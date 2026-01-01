#!/usr/bin/env -S deno run -A
/* global Deno */

/**
 * 独立 Subfount 客户端
 *
 * 此脚本通过 Trystero 连接到主 fount 实例
 * 并执行主机发送的 JavaScript 代码。
 *
 * 用法:
 *   deno run -A subfount.mjs <host-room-id> <password>
 *
 * 或交互式运行:
 *   deno run -A subfount.mjs
 */

import os from 'node:os'
import process from 'node:process'

import inquirer from 'npm:inquirer'
import { RTCPeerConnection } from 'npm:node-datachannel/polyfill'
import { on_shutdown } from 'npm:on-shutdown'
import { joinRoom } from 'npm:trystero/mqtt'

const args = process.argv.slice(2)

let hostRoomId = null
let password = null

// 解析参数
if (args.length >= 2) {
	hostRoomId = args[0]
	password = args[1]
}
else {
	// 交互模式
	const result = await inquirer.prompt([
		{
			name: 'hostRoomId',
			message: 'Enter host room ID (connection code):',
			type: 'input',
			required: true,
		},
		{
			name: 'password',
			message: 'Enter password:',
			type: 'input',
			required: true,
		},
	])
	hostRoomId = result.hostRoomId
	password = result.password
}


let room = null
let authenticated = false
let hostPeerId = null
let deviceInfo = null
let deviceInfoUpdateInterval = null
const actions = {}

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
 * 安全收集信息的辅助函数。
 * @param {string} name - 信息名称（用于日志）。
 * @param {Function} fn - 收集函数。
 * @returns {Promise<any>} - 收集到的信息或错误对象。
 */
async function safeCollect(name, fn) {
	try {
		return await fn()
	}
	catch (error) {
		console.error(`Error collecting ${name} info:`, error)
		return { error: error.message }
	}
}

/**
 * 收集设备信息。
 * @returns {Promise<object>} - 设备信息对象。
 */
async function collectDeviceInfo() {
	const deviceInfo = {
		hostname: os.hostname(),
		os: {
			type: os.type(),
			release: os.release(),
			arch: os.arch(),
			platform: process.platform,
		},
		timestamp: new Date().toISOString(),
	}

	// 收集 CPU 信息
	deviceInfo.cpu = await safeCollect('CPU', async () => {
		const osinfo = await import('npm:node-os-utils@1.3.7').then(m => m.default)
		const cpuInfo = await osinfo.cpu.average()
		const cpuUsage = (1 - cpuInfo.avgIdle / cpuInfo.avgTotal) * 100
		return {
			model: osinfo.cpu.model().replaceAll('\x00', ''),
			cores: osinfo.cpu.count(),
			frequency: cpuInfo.avgTotal / 1000, // GHz
			usage: cpuUsage,
		}
	})

	// 收集内存信息
	deviceInfo.memory = await safeCollect('memory', async () => {
		const osinfo = await import('npm:node-os-utils@1.3.7').then(m => m.default)
		const memInfo = await osinfo.mem.info()
		return {
			total: memInfo.totalMemMb, // MB
			used: memInfo.usedMemMb,
			free: memInfo.freeMemMb,
			usage: memInfo.usedMemMb / memInfo.totalMemMb * 100,
		}
	})

	// 收集磁盘信息
	deviceInfo.disk = await safeCollect('disk', async () => {
		const diskUsage = {}
		if (process.platform === 'win32') {
			// Windows 平台使用 WMIC 命令
			const command = new Deno.Command('wmic', {
				args: ['logicaldisk', 'get', 'DeviceID,Size,FreeSpace'],
				stdout: 'piped',
			})
			const { stdout } = await command.output()
			const disks = new TextDecoder().decode(stdout)
			disks.split('\n').slice(1).forEach(line => {
				const parts = line.trim().split(/\s+/)
				if (parts.length === 3) {
					const disk = parts[0]
					const freeSize = parseInt(parts[1], 10)
					const totalSize = parseInt(parts[2], 10)
					diskUsage[disk] = {
						total: totalSize / 1024 / 1024 / 1024, // GB
						free: freeSize / 1024 / 1024 / 1024,
						used: (totalSize - freeSize) / 1024 / 1024 / 1024,
						usage: (totalSize - freeSize) / totalSize * 100,
					}
				}
			})
		}
		else if (process.platform === 'linux' || process.platform === 'darwin') {
			// Linux/macOS 平台使用 df 命令
			const command = new Deno.Command('df', {
				args: ['-h'],
				stdout: 'piped',
			})
			const { stdout } = await command.output()
			const disks = new TextDecoder().decode(stdout)
			disks.split('\n').slice(1).forEach(line => {
				const parts = line.trim().split(/\s+/)
				if (parts.length >= 6) {
					const disk = parts[5]
					const totalSize = parseFloat(parts[1].replace(/[^0-9.]/g, ''))
					const usedSize = parseFloat(parts[2].replace(/[^0-9.]/g, ''))
					const unit = parts[1].replace(/[0-9.]/g, '')
					const multiplier = unit === 'G' ? 1 : unit === 'M' ? 0.001 : unit === 'T' ? 1000 : 1
					diskUsage[disk] = {
						total: totalSize * multiplier,
						used: usedSize * multiplier,
						free: (totalSize - usedSize) * multiplier,
						usage: usedSize / totalSize * 100,
					}
				}
			})
		}
		return diskUsage
	})

	// 收集 shell 可用性信息
	deviceInfo.shells = await safeCollect('shell availability', async () => {
		const { available } = await import('npm:@steve02081504/exec')
		return available
	})

	return deviceInfo
}

/**
 * 发送设备信息到主机。
 */
async function sendDeviceInfoToHost() {
	deviceInfo = await collectDeviceInfo()
	if (actions.sendDeviceInfo && hostPeerId && authenticated)
		await actions.sendDeviceInfo(deviceInfo, hostPeerId)
}

/**
 * 处理主机的运行代码请求。
 * @param {object} message - 运行代码消息对象。
 * @param {string} peerId - 发送者的对等端 ID。
 */
async function handleRunCode(message, peerId) {
	if (peerId !== hostPeerId) return

	const { payload, requestId } = message
	const { script, callbackInfo } = payload

	// 执行代码前更新设备信息
	await sendDeviceInfoToHost()

	try {
		// 导入 async_eval
		const { async_eval } = await import('https://cdn.jsdelivr.net/gh/steve02081504/async-eval/deno.mjs')

		// 为通过 Trystero 的远程调用创建回调函数
		let callback = null
		if (callbackInfo && actions.sendCallback)
			/**
			 * 远程回调函数。
			 * @param {any} data - 回调数据。
			 */
			callback = async (data) => {
				await actions.sendCallback({
					partpath: callbackInfo.partpath,
					data,
				}, hostPeerId)
			}

		// 执行代码
		const evalResult = await async_eval(script, { callback })

		const serializedResult = JSON.parse(JSON.stringify(evalResult, getCircularReplacer()))

		// 通过 Trystero 发送结果回传
		await actions.sendResponse({
			requestId,
			payload: serializedResult,
		}, hostPeerId)

		// 执行代码后更新设备信息
		await sendDeviceInfoToHost()
	}
	catch (error) {
		// 发送错误回传
		await actions.sendResponse({
			requestId,
			payload: { error: error.message, stack: error.stack },
			isError: true,
		}, hostPeerId)
	}
}

/**
 * 处理主机的 shell 执行请求。
 * @param {object} message - Shell 执行消息对象。
 * @param {string} peerId - 发送者的对等端 ID。
 */
async function handleShellExec(message, peerId) {
	if (peerId !== hostPeerId) return

	const { payload, requestId } = message
	const { command, shell, options } = payload

	try {
		// 从 @steve02081504/exec 导入 exec 函数
		const { exec, shell_exec_map } = await import('npm:@steve02081504/exec')

		// 确定要使用的 exec 函数
		let execFunction = exec
		if (shell)
			if (shell_exec_map[shell])
				execFunction = shell_exec_map[shell]
			else
				throw new Error(`Unsupported shell: ${shell}`)


		// 执行命令
		const result = await execFunction(command, options || {})

		// 通过 Trystero 发送结果回传
		await actions.sendResponse({
			requestId,
			payload: result,
		}, hostPeerId)
	}
	catch (error) {
		// 发送错误回传
		await actions.sendResponse({
			requestId,
			payload: { error: error.message, stack: error.stack },
			isError: true,
		}, hostPeerId)
	}
}

/**
 * 通过 Trystero 连接到主机。
 */
async function connectViaTrystero() {
	try {
		const config = {
			appId: 'fount-subfounts',
			rtcPolyfill: RTCPeerConnection,
			password, // 使用连接密码进行加密
		}
		room = joinRoom(config, hostRoomId)

		// 设置操作处理程序
		const actionMap = {
			authenticate: ['sendAuth', 'getAuth'],
			device_info: ['sendDeviceInfo', 'getDeviceInfo'],
			response: ['sendResponse', null],
			run_code: [null, 'getRunCode'],
			callback: ['sendCallback', null],
			shell_exec: ['sendShellExec', 'getShellExec']
		}

		for (const [name, [sendName, getName]] of Object.entries(actionMap)) {
			const [send, get] = room.makeAction(name)
			if (sendName) actions[sendName] = send
			if (getName) actions[getName] = get
		}

		// 处理身份验证响应
		actions.getAuth((data, peerId) => {
			if (data.type === 'authenticated') {
				authenticated = true
				hostPeerId = peerId
				sendDeviceInfoToHost()
				deviceInfoUpdateInterval = setInterval(async () => {
					await sendDeviceInfoToHost()
				}, 15 * 60 * 1000)
			}
			else if (data.type === 'auth_error') {
				console.error('Authentication failed:', data.error)
				setTimeout(() => {
					if (room) room.leave()
					setTimeout(connectViaTrystero, 1000)
				}, 5000)
			}
		})

		// 处理运行代码请求
		actions.getRunCode((message, peerId) => {
			if (authenticated && peerId === hostPeerId)
				handleRunCode(message, peerId)
		})

		// 处理 shell 执行请求
		actions.getShellExec((message, peerId) => {
			if (authenticated && peerId === hostPeerId)
				handleShellExec(message, peerId)
		})

		// 处理对等端加入（寻找主机）
		room.onPeerJoin((peerId) => {
			if (!authenticated && actions.sendAuth && !hostPeerId) {
				hostPeerId = peerId
				actions.sendAuth({ password }, peerId)
			}
		})

		// 处理对等端离开
		room.onPeerLeave((peerId) => {
			if (peerId === hostPeerId) {
				console.log('Host disconnected, reconnecting...')
				authenticated = false
				clearInterval(deviceInfoUpdateInterval)
				deviceInfoUpdateInterval = null
				hostPeerId = null
			}
		})
	}
	catch (error) {
		console.error('Failed to initialize Trystero:', error)
		setTimeout(connectViaTrystero, 5000)
	}
}

// 开始通过 Trystero 连接
connectViaTrystero()

// 处理优雅关闭
on_shutdown(() => {
	console.log('\nShutting down...')
	clearInterval(deviceInfoUpdateInterval)
	if (room) room.leave()
	process.exit(0)
})
