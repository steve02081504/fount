import net from 'node:net'
import process from 'node:process'

import * as Sentry from 'npm:@sentry/deno'
import { VirtualConsole } from 'npm:@steve02081504/virtual-console'

import { console, geti18n } from '../../scripts/i18n/index.mjs'
import { DEFAULT_IPC_PORT } from '../../scripts/part_invoke_result.mjs'
import { getLoadedPartList, getPartList, loadPart, getPartDetails, GetPartPath } from '../parts_loader.mjs'
import { restartor } from '../server.mjs'

/** 生产默认 IPC 监听端口（单实例 CLI 发现用）；常量定义在调用方共用的分派模块里。 */
export { DEFAULT_IPC_PORT }

/**
 * 处理 IPC 命令。
 * @param {string} command - 命令类型。
 * @param {object} data - 命令数据。
 * @returns {Promise<object>} 命令处理的结果。
 */
export async function processIPCCommand(command, data) {
	try {
		switch (command) {
			case 'runpart': {
				let { username } = data
				const { partpath, args, cwd } = data
				if (username === null) {
					const { getLastActiveUsername } = await import('../auth/index.mjs')
					username = getLastActiveUsername()
				}
				console.logI18n('fountConsole.ipc.runPartLog', { partpath, username, args: JSON.stringify(args) })
				const part = await loadPart(username, partpath)
				const vc = new VirtualConsole()
				const context = { cwd: cwd || process.cwd() }
				const result = await vc.hookAsyncContext(async () => await part.interfaces.invokes.ArgumentsHandler(username, args, context))
				// run-js 需要 part 根目录来解析模块路径；output / void 不带。
				return { status: 'ok', data: { result, outputs: vc.outputs, ...result?.type === 'run-js' && { partRoot: GetPartPath(username, partpath) } } }
			}
			case 'invokepart': {
				const { username, partpath, data: invokedata } = data
				console.logI18n('fountConsole.ipc.invokePartLog', { partpath, username, invokedata: JSON.stringify(invokedata) })
				const part = await loadPart(username, partpath)
				const result = await part.interfaces.invokes.IPCInvokeHandler(username, invokedata)
				return { status: 'ok', data: result }
			}
			case 'getlist': {
				const { username, partpath } = data
				return { status: 'ok', data: await getPartList(username, partpath) }
			}
			case 'getloadedlist': {
				const { username, partpath } = data
				return { status: 'ok', data: await getLoadedPartList(username, partpath) }
			}
			case 'getdetails': {
				const { username, partpath } = data
				return { status: 'ok', data: await getPartDetails(username, partpath) }
			}
			case 'shutdown':
				process.exit()
				return { status: 'ok' }
			case 'reboot':
				restartor()
				return { status: 'ok' }
			case 'ping':
				return { status: 'ok', data: 'pong' }
			default:
				return { status: 'error', message: geti18n('fountConsole.ipc.unsupportedCommand') }
		}
	}
	catch (err) {
		Sentry.captureException(err)
		console.errorI18n('fountConsole.ipc.processMessageError', { error: err })
		if (err.errors) console.dir(err.errors)
		else if (err.error) console.dir(err.error)
		return { status: 'error', message: err.message }
	}
}

/**
 * 管理 IPC 服务器和客户端通信。
 */
export class IPCManager {
	/**
	 * 创建 IPCManager 的实例。
	 */
	constructor() {
		this.serverV6 = null
		this.serverV4 = null
	}

	/**
	 * 启动 IPC 服务器。
	 * @param {{ port?: number }} [options] 监听选项
	 * @returns {Promise<boolean>} 如果服务器成功启动，则解析为 true，否则为 false。
	 */
	async startServer({ port = DEFAULT_IPC_PORT } = {}) {
		this.serverV6 = net.createServer(socket => {
			this.handleConnection(socket)
		})

		this.serverV4 = net.createServer(socket => {
			this.handleConnection(socket)
		})

		/**
		 * 启动一个服务器实例。
		 * @param {net.Server} server - 要启动的服务器。
		 * @param {string} address - 要监听的地址。
		 * @returns {Promise<boolean>} 如果服务器成功启动，则解析为 true，否则为 false。
		 */
		const listen = (server, address) => {
			return new Promise((resolve, reject) => {
				server.on('error', async err => {
					if (['EADDRINUSE', 'EACCES'].includes(err.code)) resolve(false)
					else if (['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(err.code)) resolve(true)
					else reject(err)
				})

				server.listen(port, address, _ => resolve(true))
			})
		}
		return Promise.all([
			listen(this.serverV6, '::1'),
			listen(this.serverV4, '127.0.0.1'),
		]).then(async results => {
			const result = results.some(result => result === true)
			if (result) console.freshLineI18n('server start', 'fountConsole.ipc.serverStarted')
			else console.logI18n('fountConsole.ipc.instanceRunning')
			return result
		})
	}

	/**
	 * 处理到 IPC 服务器的新连接。
	 * @param {net.Socket} socket - 连接的套接字。
	 * @returns {void}
	 */
	handleConnection(socket) {
		let data = ''

		socket.on('data', async chunk => {
			data += chunk
			if (data.includes('\n')) {
				const parts = data.split('\n')
				const message = parts[0]
				data = parts.slice(1).join('\n')

				try {
					const { type, data: commandData } = JSON.parse(message)
					const result = await processIPCCommand(type, commandData)
					socket.write(JSON.stringify(result) + '\n')
				}
				catch (err) {
					console.errorI18n('fountConsole.ipc.processMessageError', { error: err })
					socket.write(JSON.stringify({ status: 'error', message: err instanceof SyntaxError ? geti18n('fountConsole.ipc.invalidCommandFormat') : err.message }) + '\n')
				}
			}
		})

		socket.on('error', async err => {
			console.errorI18n('fountConsole.ipc.socketError', { error: err })
		})
	}

	/**
	 * 向 IPC 服务器发送命令。
	 * 总时限兜住“实例还在监听但永远不回帧”的情况（例如服务端停在半截启动中）；命令本身只是分派，正常远快于此。
	 * @param {string} type - 命令类型。
	 * @param {object} data - 命令数据。
	 * @param {{ port?: number, timeoutMs?: number }} [options] 连接选项
	 * @returns {Promise<any>} 一个解析为服务器响应的承诺。
	 */
	static async sendCommand(type, data, { port = DEFAULT_IPC_PORT, timeoutMs = 60_000 } = {}) {
		return new Promise((resolve, reject) => {
			const client = net.createConnection({ port })

			let responseData = ''
			let settled = false
			/**
			 * @param {Error | null} error - 传输或协议错误。
			 * @param {unknown} [value] - 成功响应。
			 */
			const finish = (error, value) => {
				if (settled) return
				settled = true
				client.destroy()
				if (error) reject(error)
				else resolve(value)
			}

			client.on('data', chunk => {
				responseData += chunk
				// 检查消息分隔符（换行符）
				if (responseData.includes('\n')) {
					const [message] = responseData.split('\n')
					try {
						const response = JSON.parse(message)
						if (response.status === 'ok') finish(null, response.data)
						else finish(new Error(response.message || geti18n('fountConsole.ipc.unknownError')))
					} catch (error) {
						finish(error)
					}
				}
			})

			client.on('error', err => finish(err))
			client.on('close', () => finish(new Error('IPC connection closed before a complete response')))
			client.setTimeout(timeoutMs, () => finish(Object.assign(new Error('IPC response timed out'), { code: 'ETIMEDOUT' })))

			client.setEncoding('utf8')
			client.on('connect', () => {
				client.write(JSON.stringify({ type, data }) + '\n')
			})
		})
	}
}
