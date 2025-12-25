#!/usr/bin/env -S deno run --allow-net --allow-env --allow-run --allow-read

/**
 * Standalone Subfount Client
 *
 * This script connects to a main fount instance via PeerJS
 * and executes JavaScript code sent from the host.
 *
 * Usage:
 *   deno run --allow-net --allow-env --allow-run --allow-read subfount.mjs <host-peer-id> <password>
 *
 * Or interactively:
 *   deno run --allow-net --allow-env --allow-run --allow-read subfount.mjs
 */

import os from 'node:os'
import process from 'node:process'

import { prompt } from 'npm:inquirer'
import { on_shutdown } from 'npm:on-shutdown'
import PeerJS from 'npm:peerjs'

const args = process.argv.slice(2)

let hostPeerId = null
let password = null

// Parse arguments
if (args.length >= 2) {
	hostPeerId = args[0]
	password = args[1]
}
else {
	// Interactive mode
	const result = await prompt([
		{
			name: 'hostPeerId',
			message: 'Enter host Peer ID (connection code):',
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
	hostPeerId = result.hostPeerId
	password = result.password
}

console.log(`Connecting to host ${hostPeerId} via PeerJS...`)

let peer = null
let dataConnection = null
let deviceInfo = null
let deviceInfoUpdateInterval = null

/**
 * Collects device information.
 * @returns {Promise<object>} - Device information object.
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

	try {
		// Get CPU information using node-os-utils
		const osinfo = await import('npm:node-os-utils@1.3.7').then(m => m.default)
		const cpuInfo = await osinfo.cpu.average()
		const cpuUsage = (1 - cpuInfo.avgIdle / cpuInfo.avgTotal) * 100

		deviceInfo.cpu = {
			model: osinfo.cpu.model().replaceAll('\x00', ''),
			cores: osinfo.cpu.count(),
			frequency: cpuInfo.avgTotal / 1000, // GHz
			usage: cpuUsage,
		}
	}
	catch (error) {
		console.error('Error collecting CPU info:', error)
		deviceInfo.cpu = { error: error.message }
	}

	try {
		// Get memory information
		const osinfo = await import('npm:node-os-utils@1.3.7').then(m => m.default)
		const memInfo = await osinfo.mem.info()

		deviceInfo.memory = {
			total: memInfo.totalMemMb, // MB
			used: memInfo.usedMemMb,
			free: memInfo.freeMemMb,
			usage: memInfo.usedMemMb / memInfo.totalMemMb * 100,
		}
	}
	catch (error) {
		console.error('Error collecting memory info:', error)
		deviceInfo.memory = { error: error.message }
	}

	try {
		// Get disk information
		const diskUsage = {}
		if (process.platform === 'win32') {
			// Windows platform uses WMIC command
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
			// Linux/macOS platform uses df command
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
		deviceInfo.disk = diskUsage
	}
	catch (error) {
		console.error('Error collecting disk info:', error)
		deviceInfo.disk = { error: error.message }
	}

	return deviceInfo
}

/**
 * Sends device information to the host.
 */
async function sendDeviceInfo() {
	deviceInfo = await collectDeviceInfo()
	const message = JSON.stringify({
		type: 'device_info',
		payload: deviceInfo,
	})

	if (dataConnection?.open)
		dataConnection.send(message)
	else
		console.warn('PeerJS connection not available, cannot send device info')
}

/**
 * Handles messages from host.
 * @param {string | any} data - Message data (parsed from PeerJS).
 */
async function handleHostMessage(data) {
	let message
	if (typeof data === 'string')
		message = JSON.parse(data)
	else
		message = data

	switch (message.type) {
		case 'authenticated':
			console.log('Authentication successful')
			break
		case 'run_code': {
			const { script, callbackInfo, requestId } = message.payload || message
			console.log('Received code to execute')

			// Update device info before executing code
			await sendDeviceInfo()

			try {
				// Import async_eval
				const { async_eval } = await import('https://esm.sh/@steve02081504/async-eval')

				// Create callback function for remote calls via PeerJS (P2P)
				let callback = null
				if (callbackInfo)
					/**
					 * Remote callback function.
					 * @param {any} data - Callback data.
					 */
					callback = async (data) => {
						// Send callback via PeerJS (P2P, no server auth needed)
						if (dataConnection && dataConnection.open)
							try {
								dataConnection.send(JSON.stringify({
									type: 'callback',
									payload: {
										partpath: callbackInfo.partpath,
										data,
									},
								}))
							}
							catch (error) {
								console.error('Error sending callback via PeerJS:', error)
							}
						else
							console.error('PeerJS connection not available, cannot send callback')
					}

				// Execute the code
				const evalResult = await async_eval(script, { callback })

				// JSON serialize the result
				/**
				 * Get a circular reference replacer for JSON.stringify.
				 * @returns {function(string, any): any} - Replacer function.
				 */
				const getCircularReplacer = () => {
					const seen = new WeakSet()
					return (_key, value) => {
						if (typeof value === 'object' && value !== null) {
							if (seen.has(value)) return '[Circular]'
							seen.add(value)
						}
						return value
					}
				}

				const serializedResult = JSON.parse(JSON.stringify(evalResult.result, getCircularReplacer()))

				// Send result back via PeerJS
				const responseMessage = JSON.stringify({
					type: 'response',
					requestId: requestId || message.requestId,
					payload: { result: serializedResult },
				})

				if (dataConnection?.open)
					dataConnection.send(responseMessage)
				else
					console.error('PeerJS connection not available, cannot send response')

				// Update device info after executing code
				await sendDeviceInfo()
			}
			catch (error) {
				// Send error back
				const errorMessage = JSON.stringify({
					type: 'response',
					requestId: requestId || message.requestId,
					payload: { error: error.message, stack: error.stack },
					isError: true,
				})

				if (dataConnection?.open)
					dataConnection?.send(errorMessage)
				else
					console.error('PeerJS connection not available, cannot send error response')
			}
			break
		}
		case 'get_device_info':
			// Host is requesting device info
			await sendDeviceInfo()
			break
		default:
			console.log('Unknown message type:', message.type)
	}
}

/**
 * Connects to host via PeerJS.
 */
async function connectViaPeerJS() {
	try {
		// Use PeerJS default public server
		peer = new PeerJS({
			host: '0.peerjs.com',
			port: 443,
			path: '/',
			secure: true,
		})

		peer.on('open', (id) => {
			console.log('Subfount PeerJS peer opened with ID:', id)
			connectToHostPeer()
		})

		peer.on('error', (error) => {
			console.error('PeerJS error:', error)
			console.error('Reconnecting in 5 seconds...')
			setTimeout(connectViaPeerJS, 5000)
		})
	}
	catch (error) {
		console.error('Failed to initialize PeerJS:', error)
		console.error('Reconnecting in 5 seconds...')
		setTimeout(connectViaPeerJS, 5000)
	}
}

/**
 * Connects to the host peer via PeerJS.
 */
function connectToHostPeer() {
	if (!peer) return

	dataConnection = peer.connect(hostPeerId, {
		reliable: true,
	})

	dataConnection.on('open', async () => {
		console.log('Connected to host via PeerJS')
		// Send authentication
		dataConnection.send(JSON.stringify({
			type: 'authenticate',
			password,
		}))

		// Send initial device info
		await sendDeviceInfo()

		// Set up periodic device info updates (every 15 minutes)
		deviceInfoUpdateInterval = setInterval(async () => {
			await sendDeviceInfo()
		}, 15 * 60 * 1000) // 15 minutes
	})

	dataConnection.on('data', handleHostMessage)

	dataConnection.on('close', () => {
		console.log('PeerJS connection to host closed, reconnecting...')
		clearInterval(deviceInfoUpdateInterval)
		deviceInfoUpdateInterval = null
		setTimeout(connectToHostPeer, 5000)
	})

	dataConnection.on('error', (error) => {
		console.error('PeerJS DataConnection error:', error)
	})
}

// Start connection via PeerJS
connectViaPeerJS()

// Handle graceful shutdown
on_shutdown(() => {
	console.log('\nShutting down...')
	clearInterval(deviceInfoUpdateInterval)
	dataConnection.close()
	peer?.destroy()
	process.exit(0)
})
