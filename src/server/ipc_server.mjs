import net from 'node:net'
import { console } from 'npm:@steve02081504/virtual-console'
import { geti18n } from '../scripts/i18n.mjs'
import { getLoadedPartList, getPartList, loadPart } from './managers/index.mjs'
import { getPartDetails } from './parts_loader.mjs'

const IPC_PORT = 16698 // 选择一个不太可能冲突的端口

/**
 * 处理 IPC 命令。
 * @param {string} command - 命令类型。
 * @param {object} data - 命令数据。
 * @returns {Promise<object>} - 处理结果。
 */
export async function processIPCCommand(command, data) {
	try {
		switch (command) {
			case 'runpart': {
				const { username, parttype, partname, args } = data
				console.log(await geti18n('fountConsole.ipc.runPartLog', { parttype, partname, username, args: JSON.stringify(args) }))
				const part = await loadPart(username, parttype, partname)
				const result = await part.interfaces.invokes.ArgumentsHandler(username, args)
				return { status: 'ok', data: result }
			}
			case 'invokepart': {
				const { username, parttype, partname, data: invokedata } = data
				console.log(await geti18n('fountConsole.ipc.invokePartLog', { parttype, partname, username, invokedata: JSON.stringify(invokedata) }))
				const part = await loadPart(username, parttype, partname)
				const result = await part.interfaces.invokes.IPCInvokeHandler(username, invokedata)
				return { status: 'ok', data: result }
			}
			case 'getlist': {
				const { username, parttype } = data
				return { status: 'ok', data: await getPartList(username, parttype) }
			}
			case 'getloadedlist': {
				const { username, parttype } = data
				return { status: 'ok', data: await getLoadedPartList(username, parttype) }
			}
			case 'getdetails': {
				const { username, parttype, partname } = data
				return { status: 'ok', data: await getPartDetails(username, parttype, partname) }
			}
			case 'shutdown':
				process.exit()
				return { status: 'ok' }
			case 'ping':
				return { status: 'ok', data: 'pong' }
			default:
				return { status: 'error', message: await geti18n('fountConsole.ipc.unsupportedCommand') }
		}
	} catch (err) {
		console.error(await geti18n('fountConsole.ipc.processMessageError', { error: err }))
		return { status: 'error', message: err.message }
	}
}

export class IPCManager {
	constructor() {
		this.serverV6 = null
		this.serverV4 = null
	}

	async startServer() {
		this.serverV6 = net.createServer((socket) => {
			this.handleConnection(socket)
		})

		this.serverV4 = net.createServer((socket) => {
			this.handleConnection(socket)
		})

		const startServer = (server, address) => {
			return new Promise((resolve, reject) => {
				server.on('error', async (err) => {
					if (err.code === 'EADDRINUSE') {
						console.log(await geti18n('fountConsole.ipc.instanceRunning', { address }))
						resolve(false) // 服务器已在运行
					} else
						reject(err)
				})

				server.listen(IPC_PORT, address, _ => resolve(true))
			})
		}
		// 使用 Promise.all 确保两个监听都成功后才返回 true
		return Promise.all([
			startServer(this.serverV6, '::1'),
			startServer(this.serverV4, '127.0.0.1'),
		]).then(async results => {
			console.freshLine('server start', await geti18n('fountConsole.ipc.serverStarted'))
			return results.every(result => result === true)
		})
	}

	handleConnection(socket) {
		let data = ''

		socket.on('data', async (chunk) => {
			data += chunk
			if (data.includes('\n')) {
				const parts = data.split('\n')
				const message = parts[0]
				data = parts.slice(1).join('\n')

				try {
					const { type, data: commandData } = JSON.parse(message)
					const result = await processIPCCommand(type, commandData)
					socket.write(JSON.stringify(result) + '\n')
				} catch (err) {
					console.error(await geti18n('fountConsole.ipc.processMessageError', { error: err }))
					socket.write(JSON.stringify({ status: 'error', message: err instanceof SyntaxError ? await geti18n('fountConsole.ipc.invalidCommandFormat') : err.message }) + '\n')
				}
			}
		})

		socket.on('error', async (err) => {
			console.error(await geti18n('fountConsole.ipc.socketError', { error: err }))
		})
	}

	static async sendCommand(type, data) {
		return new Promise((resolve, reject) => {
			const client = net.createConnection({ port: IPC_PORT }, () => {
				client.write(JSON.stringify({ type, data }) + '\n') // 添加换行符作为结束
			})

			let responseData = ''
			client.setEncoding('utf8') // 确保使用正确编码

			client.on('data', async (chunk) => {
				responseData += chunk
				// 检查消息分隔符（换行符）
				if (responseData.includes('\n')) {
					const parts = responseData.split('\n')
					const message = parts[0] // 提取完整消息
					responseData = parts.slice(1).join('\n') // 剩余数据保留

					try {
						const response = JSON.parse(message)
						if (response.status === 'ok')
							resolve(response.data) // 返回结果
						else
							reject(new Error(response.message || await geti18n('fountConsole.ipc.unknownError')))
					} catch (err) {
						console.error(await geti18n('fountConsole.ipc.parseResponseFailed', { error: err }))
						reject(new Error(await geti18n('fountConsole.ipc.cannotParseResponse')))
					} finally {
						client.end() // 处理完成后关闭连接
					}
				}
			})

			client.on('error', (err) => {
				client.destroy()
				reject(err)
			})
		})
	}
}
