#!/usr/bin/env -S deno run --allow-scripts --allow-all

/**
 * 独立 Subfount 客户端
 *
 * - 参与 fount 网络层 infra（overlay 转发 + mailbox）。
 * - 未设置主机：standalone infra。
 * - 设置主机后：一边跑 infra，一边从主机拉取信誉表并优先帮扶主机及其信任节点；
 *   同时接受主机下发的 run_code / shell_exec。
 *
 * 首次使用:
 *   1. 将此文件放入一个空文件夹
 *   2. 在该文件夹中运行: deno install --allow-scripts --allow-all --entrypoint subfount.mjs
 *   3. infra only: deno run --allow-scripts --allow-all subfount.mjs
 *   4. 挂主机: deno run --allow-scripts --allow-all subfount.mjs <host-room-id> <password> [host-node-hash]
 *      host-node-hash 可选；提供时可直连主机，不必只靠 discovery。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { setInterval, clearInterval, setTimeout } from 'node:timers'
import { fileURLToPath } from 'node:url'

process.on('uncaughtException', (err) => {
	if (err?.code === 'ECONNRESET' || err?.code === 'ECONNREFUSED' || err?.message?.includes('socket hang up'))
		return
	console.error('Uncaught exception:', err)
	process.exit(1)
})

// --- 自动引导：确保 deno.json 和 node_modules 存在 ---
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const denoJsonPath = path.join(__dirname, 'deno.json')

if (!fs.existsSync(denoJsonPath)) {
	fs.writeFileSync(denoJsonPath, JSON.stringify({ nodeModulesDir: 'auto' }, null, '\t') + '\n')
	console.log('Created deno.json')
}
else
	try {
		const existing = JSON.parse(fs.readFileSync(denoJsonPath, 'utf-8'))
		if (!existing.nodeModulesDir) {
			existing.nodeModulesDir = 'auto'
			fs.writeFileSync(denoJsonPath, JSON.stringify(existing, null, '\t') + '\n')
			console.log('Updated deno.json (added nodeModulesDir)')
		}
	}
	catch { /* ignore */ }

const REPUTATION_PULL_INTERVAL_MS = 15 * 60 * 1000
const DEVICE_INFO_INTERVAL_MS = 15 * 60 * 1000

/** @type {typeof import('npm:@steve02081504/exec').exec} */
let exec
/** @type {import('npm:inquirer').default} */
let inquirer
/** @type {import('npm:on-shutdown').on_shutdown} */
let on_shutdown
/** @type {typeof import('npm:@steve02081504/fount-p2p')} */
let p2p

try {
	;({ exec } = await import('npm:@steve02081504/exec'))
	;({ default: inquirer } = await import('npm:inquirer'))
	;({ on_shutdown } = await import('npm:on-shutdown'))
	p2p = await import('npm:@steve02081504/fount-p2p')
	await p2p.startNode({ nodeDir: path.join(__dirname, '.fount-p2p-node') })
}
catch (error) {
	console.error('\nFailed to load dependencies:', error.message)
	console.log('\nTo fix:')
	console.log('  1. Ensure deno.json exists in this directory (auto-created on first run)')
	console.log('  2. Run: deno install --allow-scripts --allow-all --entrypoint subfount.mjs')
	console.log('  3. Re-run this script\n')
	process.exit(1)
}

const args = process.argv.slice(2)

let hostRoomId = null
let password = null
/** @type {string | null} */
let hostNodeHashHint = null

if (args.length >= 2) {
	hostRoomId = args[0]
	password = args[1]
	hostNodeHashHint = args[2]?.trim().toLowerCase() || null
}
else if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
	console.log(`Usage:
  subfount.mjs                                    infra only
  subfount.mjs <host-room-id> <password> [node-hash]
      infra + host worker / priority assist
`)
	process.exit(0)
}
else if (args.length === 0 && process.stdin.isTTY) {
	const result = await inquirer.prompt([
		{
			name: 'hostRoomId',
			message: 'Host room ID (connection code, empty = infra only):',
			type: 'input',
			required: false,
		},
		{
			name: 'password',
			message: 'Host password:',
			type: 'input',
			required: false,
			when: answers => Boolean(answers.hostRoomId?.trim()),
		},
		{
			name: 'hostNodeHash',
			message: 'Host nodeHash (optional, from connection-code API):',
			type: 'input',
			required: false,
			when: answers => Boolean(answers.hostRoomId?.trim()),
		},
	])
	hostRoomId = result.hostRoomId?.trim() || null
	password = result.password?.trim() || null
	hostNodeHashHint = result.hostNodeHash?.trim().toLowerCase() || null
}
else if (args.length === 1) {
	console.error('Usage: subfount.mjs [<host-room-id> <password> [host-node-hash]]')
	process.exit(2)
}

const localNodeHash = p2p.getNodeHash()
/** 无主机时默认跑 infra；挂上主机后由主机策略覆盖。 */
let infraEnabled = true
if (!(hostRoomId && password)) {
	await p2p.startInfra({ logger: console })
	console.log(`Infra running (nodeHash=${localNodeHash})`)
}
else
	console.log(`Subfount worker starting (nodeHash=${localNodeHash}); awaiting host infra policy`)

/** @type {any} */
let room = null
let authenticated = false
/** @type {string | null} */
let hostNodeHash = null
let deviceInfo = null
/** @type {ReturnType<typeof setInterval> | null} */
let deviceInfoUpdateInterval = null
/** @type {ReturnType<typeof setInterval> | null} */
let reputationPullInterval = null
/** @type {string | null} */
let deviceId = null
/** @type {Record<string, Function>} */
const actions = {}

/**
 * 生成基于机器码的唯一标识符。
 * @returns {Promise<string>} - 基于机器信息的唯一 ID。
 */
async function generateDeviceId() {
	try {
		const machineInfo = {
			hostname: os.hostname(),
			platform: process.platform,
			arch: os.arch(),
			type: os.type(),
			release: os.release(),
		}

		try {
			const networkInterfaces = os.networkInterfaces()
			const macAddresses = []
			for (const interfaceName in networkInterfaces) {
				const interfaces = networkInterfaces[interfaceName]
				if (interfaces)
					for (const iface of interfaces)
						if (iface.mac && iface.mac !== '00:00:00:00:00:00')
							macAddresses.push(iface.mac)
			}
			if (macAddresses.length > 0) machineInfo.mac = macAddresses[0]
		}
		catch (error) {
			console.warn('Failed to get MAC address:', error.message)
		}

		try {
			const cpus = os.cpus()
			if (cpus?.length > 0) machineInfo.cpuModel = cpus[0].model
		}
		catch { /* ignore */ }

		const machineString = JSON.stringify(machineInfo)
		const encoder = new TextEncoder()
		const data = encoder.encode(machineString)
		const hashBuffer = await crypto.subtle.digest('SHA-256', data)
		const hashArray = Array.from(new Uint8Array(hashBuffer))
		const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
		return hashHex.substring(0, 32)
	}
	catch (error) {
		console.error('Failed to generate machine ID, falling back to hostname:', error)
		return os.hostname().replace(/[^\dA-Za-z]/g, '').substring(0, 32) || 'subfount-client'
	}
}

/**
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
 * @returns {Promise<object>} - 设备信息对象。
 */
async function collectDeviceInfo() {
	const info = {
		hostname: os.hostname(),
		os: {
			type: os.type(),
			release: os.release(),
			arch: os.arch(),
			platform: process.platform,
		},
		timestamp: new Date().toISOString(),
	}

	info.cpu = await safeCollect('CPU', async () => {
		const osinfo = await import('npm:node-os-utils@1.3.7').then(m => m.default)
		const cpuInfo = await osinfo.cpu.average()
		const cpuUsage = (1 - cpuInfo.avgIdle / cpuInfo.avgTotal) * 100
		return {
			model: osinfo.cpu.model().replaceAll('\x00', ''),
			cores: osinfo.cpu.count(),
			frequency: cpuInfo.avgTotal / 1000,
			usage: cpuUsage,
		}
	})

	info.memory = await safeCollect('memory', async () => {
		const osinfo = await import('npm:node-os-utils@1.3.7').then(m => m.default)
		const memInfo = await osinfo.mem.info()
		return {
			total: memInfo.totalMemMb,
			used: memInfo.usedMemMb,
			free: memInfo.freeMemMb,
			usage: memInfo.usedMemMb / memInfo.totalMemMb * 100,
		}
	})

	info.disk = await safeCollect('disk', async () => {
		const diskUsage = {}
		if (process.platform === 'win32') {
			const disks = (await exec('wmic logicaldisk get DeviceID,Size,FreeSpace')).stdout
			disks.split('\n').slice(1).forEach(line => {
				const parts = line.trim().split(/\s+/)
				if (parts.length === 3) {
					const disk = parts[0]
					const freeSize = Number(parts[1])
					const totalSize = Number(parts[2])
					diskUsage[disk] = {
						total: totalSize / 1024 / 1024 / 1024,
						free: freeSize / 1024 / 1024 / 1024,
						used: (totalSize - freeSize) / 1024 / 1024 / 1024,
						usage: (totalSize - freeSize) / totalSize * 100,
					}
				}
			})
		}
		else if (process.platform === 'linux' || process.platform === 'darwin') {
			const disks = (await exec('df -h')).stdout
			disks.split('\n').slice(1).forEach(line => {
				const parts = line.trim().split(/\s+/)
				if (parts.length >= 6) {
					const disk = parts[5]
					const totalSize = parseFloat(parts[1].replace(/[^\d.]/g, ''))
					const usedSize = parseFloat(parts[2].replace(/[^\d.]/g, ''))
					const unit = parts[1].replace(/[\d.]/g, '')
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

	info.shells = await safeCollect('shell availability', async () => {
		const { available } = await import('npm:@steve02081504/exec')
		return available
	})

	return info
}

/**
 * 发送设备信息到主机。
 */
async function sendDeviceInfoToHost() {
	deviceInfo = await collectDeviceInfo()
	if (actions.sendDeviceInfo && hostNodeHash && authenticated)
		await actions.sendDeviceInfo(deviceInfo, hostNodeHash)
}

/**
 * 从主机拉取信誉表并应用到本地（用于 infra 路由加权）。
 */
async function pullHostReputation() {
	if (!hostNodeHash || !authenticated) return
	try {
		const table = await Promise.race([
			p2p.pullReputationFromNode(hostNodeHash),
			new Promise((_, reject) => {
				setTimeout(() => reject(new Error('reputation pull timed out')), 10_000)
			}),
		])
		await p2p.setReputationTable(table)
		console.log('✓ Pulled reputation table from host')
	}
	catch (error) {
		console.warn('Reputation pull failed:', error.message)
	}
}

/**
 * 清除对本机（主机）的优先加权；保留 hostNodeHash 以便远程执行。
 */
async function clearHostPriority() {
	if (reputationPullInterval) {
		clearInterval(reputationPullInterval)
		reputationPullInterval = null
	}
	const locked = hostNodeHash || p2p.getReputationLocks()[0]
	if (locked) await p2p.unlockReputationMax([locked])
	p2p.setTrustSyncDonors([])
	p2p.setInfraPriority({ useLocalReputation: false })
}

/**
 * 挂上主机后：锁定主机满分、拉取信任表、启用信誉加权。
 * @param {string} nodeHash - 主机 nodeHash
 */
async function enableHostAssist(nodeHash) {
	hostNodeHash = nodeHash
	if (!infraEnabled) return
	p2p.setTrustSyncDonors([nodeHash])
	await p2p.lockReputationMax([nodeHash])
	p2p.setInfraPriority({ useLocalReputation: true })
	await pullHostReputation()
	if (reputationPullInterval) clearInterval(reputationPullInterval)
	reputationPullInterval = setInterval(() => {
		void pullHostReputation()
	}, REPUTATION_PULL_INTERVAL_MS).unref()
}

/**
 * @param {{ infra?: boolean } | null | undefined} data 策略载荷
 * @returns {boolean} 是否启用 infra
 */
function readInfraPolicy(data) {
	return data?.infra !== false
}

/**
 * 应用主机下发的 infra 策略。
 * @param {boolean} enabled - 是否参与网络 infra
 */
async function applyInfra(enabled) {
	infraEnabled = Boolean(enabled)
	if (infraEnabled) {
		if (!p2p.isInfraRunning()) await p2p.startInfra({ logger: console })
		if (authenticated && hostNodeHash) await enableHostAssist(hostNodeHash)
		console.log(authenticated
			? '✓ Infra enabled (host priority assist)'
			: '✓ Infra enabled')
		return
	}
	await clearHostPriority()
	if (p2p.isInfraRunning()) await p2p.stopInfra()
	console.log('✓ Infra disabled by host policy')
}

/**
 * 主机断开：卸优先；离开主机管辖后默认恢复 infra。
 */
async function onHostDisconnected() {
	await clearHostPriority()
	hostNodeHash = null
	infraEnabled = true
	if (!p2p.isInfraRunning()) await p2p.startInfra({ logger: console })
}

/**
 * @param {object} message - 运行代码消息对象。
 * @param {string} peerId - 发送者的对等端 ID。
 */
async function handleRunCode(message, peerId) {
	if (peerId !== hostNodeHash) return

	const { payload, requestId } = message
	const { script, callbackInfo } = payload

	await sendDeviceInfoToHost()

	try {
		const { async_eval } = await import('npm:@steve02081504/async-eval')

		let callback = null
		if (callbackInfo && actions.sendCallback)
			callback = async (data) => {
				await actions.sendCallback({
					partpath: callbackInfo.partpath,
					data,
				}, hostNodeHash)
			}

		const evalResult = await async_eval(script, { callback })

		await actions.sendResponse({
			requestId,
			payload: evalResult,
		}, hostNodeHash)

		await sendDeviceInfoToHost()
	}
	catch (error) {
		await actions.sendResponse({
			requestId,
			payload: { error: error.message, stack: error.stack },
			isError: true,
		}, hostNodeHash)
	}
}

/**
 * @param {object} message - Shell 执行消息对象。
 * @param {string} peerId - 发送者的对等端 ID。
 */
async function handleShellExec(message, peerId) {
	if (peerId !== hostNodeHash) return

	const { payload, requestId } = message
	const { command, shell, options } = payload

	try {
		const { exec: run, shell_exec_map } = await import('npm:@steve02081504/exec')

		if (shell) {
			if (!shell_exec_map[shell])
				throw new Error(`Unsupported shell: ${shell}`)
			const result = await shell_exec_map[shell](command, options || {})
			await actions.sendResponse({
				requestId,
				payload: result,
			}, hostNodeHash)
			return
		}

		const result = await run(command, options || {})
		await actions.sendResponse({
			requestId,
			payload: result,
		}, hostNodeHash)
	}
	catch (error) {
		await actions.sendResponse({
			requestId,
			payload: { error: error.message, stack: error.stack },
			isError: true,
		}, hostNodeHash)
	}
}

/**
 * 通过 scope room 连接到主机。
 */
async function connectViaP2P() {
	try {
		console.log('Connecting to host...')
		deviceId = await generateDeviceId()

		if (hostNodeHashHint) {
			const { getLink, ensureLinkToNode } = await import('npm:@steve02081504/fount-p2p/transport/link_registry')
			for (let attempt = 0; attempt < 30; attempt++) {
				if (getLink(hostNodeHashHint)) break
				void ensureLinkToNode(hostNodeHashHint).catch(() => null)
				await new Promise(resolve => setTimeout(resolve, 1000))
			}
		}

		room = p2p.createGroupLinkSet({
			groupId: `subfount:${hostRoomId}`,
			scope: `subfount:${hostRoomId}`,
			roomSecret: password,
			members: hostNodeHashHint ? [hostNodeHashHint] : [],
			dialAll: true,
			autoconnect: true,
		})
		await room.start()

		const actionMap = {
			authenticate: ['sendAuth', 'getAuth'],
			device_info: ['sendDeviceInfo', 'getDeviceInfo'],
			response: ['sendResponse', null],
			run_code: [null, 'getRunCode'],
			callback: ['sendCallback', null],
			shell_exec: [null, 'getShellExec'],
			infra: [null, 'getInfra'],
		}

		for (const [name, [sendName, getName]] of Object.entries(actionMap)) {
			const [send, get] = room.makeAction(name)
			if (sendName) actions[sendName] = send
			if (getName) actions[getName] = get
		}

		actions.getAuth((data, peerId) => {
			if (hostNodeHashHint && peerId !== hostNodeHashHint) return
			if (data.type === 'authenticated') {
				authenticated = true
				hostNodeHash = peerId
				console.log('✓ Connected to host')
				void applyInfra(readInfraPolicy(data))
				void sendDeviceInfoToHost()
				if (deviceInfoUpdateInterval) clearInterval(deviceInfoUpdateInterval)
				deviceInfoUpdateInterval = setInterval(sendDeviceInfoToHost, DEVICE_INFO_INTERVAL_MS).unref()
			}
			else if (data.type === 'auth_error') {
				console.log('✗ Authentication failed, retrying in 5 seconds...')
				setTimeout(() => {
					if (room) void room.leave()
					setTimeout(connectViaP2P, 1000)
				}, 5000)
			}
		})

		actions.getInfra((data, peerId) => {
			if (!authenticated || peerId !== hostNodeHash) return
			void applyInfra(readInfraPolicy(data))
		})

		/**
		 * @param {Function} handler - 请求处理函数。
		 * @returns {Function} 已验证的请求处理函数。
		 */
		const handleAuthenticatedRequest = (handler) => (message, peerId) => {
			if (authenticated && peerId === hostNodeHash) handler(message, peerId)
		}
		actions.getRunCode(handleAuthenticatedRequest(handleRunCode))
		actions.getShellExec(handleAuthenticatedRequest(handleShellExec))

		room.onPeerJoin((peerId) => {
			if (hostNodeHashHint && peerId !== hostNodeHashHint) return
			if (!authenticated && actions.sendAuth && !hostNodeHash) {
				console.log('Host discovered, sending authentication...')
				hostNodeHash = peerId
				actions.sendAuth({ password, deviceId }, peerId)
			}
		})

		room.onPeerLeave((peerId) => {
			if (peerId === hostNodeHash) {
				console.log('✗ Disconnected from host (standalone infra default)')
				authenticated = false
				clearInterval(deviceInfoUpdateInterval)
				deviceInfoUpdateInterval = null
				void onHostDisconnected()
			}
		})
	}
	catch (error) {
		console.error('Connection failed:', error.message)
		console.log('Retrying in 5 seconds...')
		setTimeout(connectViaP2P, 5000)
	}
}

if (hostRoomId && password)
	connectViaP2P()
else
	console.log('No host configured — infra overlay/mailbox only')

on_shutdown(async () => {
	console.log('\nShutting down...')
	clearInterval(deviceInfoUpdateInterval)
	await clearHostPriority()
	if (room) await room.leave()
	if (p2p.isInfraRunning()) await p2p.stopInfra()
})
