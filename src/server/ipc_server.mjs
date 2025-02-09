import net from 'node:net'
import { console } from '../scripts/console.mjs'
import { loadShell } from './managers/shell_manager.mjs'
import { shutdown } from './on_shutdown.mjs'

const IPC_PORT = 16698 // 选择一个不太可能冲突的端口

export class IPCManager {
	constructor() {
		this.server = null
	}

	async startServer() {
		this.server = net.createServer((socket) => {
			let data = ''

			socket.on('data', (chunk) => {
				data += chunk
				// 检查消息分隔符（换行符）
				if (data.includes('\n')) {
					const parts = data.split('\n')
					const message = parts[0] // 提取完整消息
					data = parts.slice(1).join('\n') // 剩余数据保留
					this.processCommand(message, socket) // 处理消息
				}
			})

			socket.on('error', (err) => {
				console.error('Socket 错误:', err)
			})
		})

		return new Promise((resolve, reject) => {
			this.server.on('error', (err) => {
				if (err.code === 'EADDRINUSE') {
					console.log('另一个实例正在运行')
					resolve(false) // 服务器已在运行
				} else
					reject(err)

			})

			this.server.listen(IPC_PORT, () => {
				console.freshLine('server start', 'IPC 服务器已启动')
				resolve(true) // 成功启动服务器
			})
		})
	}

	async processCommand(rawData, socket) {
		try {
			const command = JSON.parse(rawData)
			if (command.type === 'runshell') {
				const { username, shellname, args } = command.data
				console.log(`运行 shell ${shellname} 作为 ${username}，参数：${JSON.stringify(args)}`)
				const shell = await loadShell(username, shellname)
				const result = await shell.ArgumentsHandler(username, args)
				socket.write(JSON.stringify({ status: 'ok', data: result }) + '\n') // 添加换行符作为结束
			}
			else if (command.type === 'invokeshell') {
				const { username, shellname, data } = command.data
				console.log(`调用 shell ${shellname} 作为 ${username}，参数：${JSON.stringify(data)}`)
				const shell = await loadShell(username, shellname)
				const result = await shell.IPCInvokeHandler(username, data)
				socket.write(JSON.stringify({ status: 'ok', data: result }) + '\n')
			}
			else if (command.type === 'shutdown')
				shutdown()
			else if (command.type === 'ping')
				socket.write(JSON.stringify({ status: 'ok', message: 'pong' }) + '\n')
			else
				socket.write(JSON.stringify({ status: 'error', message: '不支持的命令类型' }) + '\n')
		} catch (err) {
			console.error('处理 IPC 消息时出错：', err)
			socket.write(JSON.stringify({ status: 'error', message: err.message }) + '\n')
		}
	}

	static async sendCommand(type, data) {
		return new Promise((resolve, reject) => {
			const client = net.createConnection({ port: IPC_PORT }, () => {
				client.write(JSON.stringify({ type, data }) + '\n') // 添加换行符作为结束
			})

			let responseData = ''
			client.setEncoding('utf8') // 确保使用正确编码

			client.on('data', (chunk) => {
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
							reject(new Error(response.message || '未知错误'))

					} catch (err) {
						console.error('解析服务器响应失败:', err)
						reject(new Error('无法解析服务器响应'))
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
