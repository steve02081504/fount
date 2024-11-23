import net from 'node:net'
import { console } from './console.mjs'
import { loadShell } from './shell_manager.mjs'

const IPC_PORT = 16698  // 选择一个不太可能冲突的端口

export class IPCManager {
	constructor() {
		this.server = null
	}

	async startServer() {
		this.server = net.createServer(async (socket) => {
			let data = ''

			socket.on('data', chunk => {
				data += chunk
			})

			socket.on('end', async () => {
				try {
					const command = JSON.parse(data)
					if (command.type === 'shell') {
						const { username, shellname, args } = command.data
						console.log(`运行 shell ${shellname} 作为 ${username}，参数：${JSON.stringify(args)}!`)
						const shell = await loadShell(username, shellname)
						await shell.ArgumentsHandler(username, args)
					}
					// 发送确认消息
					socket.end('ok')
				} catch (err) {
					console.error('处理 IPC 消息时出错：', err)
					socket.end('error')
				}
			})
		})

		return new Promise((resolve, reject) => {
			this.server.on('error', (err) => {
				if (err.code === 'EADDRINUSE') {
					console.log('another fount is running')
					resolve(false)  // 服务器已在运行
				}
				else
					reject(err)
			})

			this.server.listen(IPC_PORT, () => {
				console.freshLine('server start', 'IPC server ready')
				resolve(true)  // 成功启动服务器
			})
		})
	}

	static async sendCommand(type, data) {
		return new Promise((resolve, reject) => {
			const client = net.createConnection({ port: IPC_PORT }, () => {
				client.write(JSON.stringify({ type, data }))
				client.end()
			})

			client.on('error', (err) => {
				client.destroy()
				reject(err)
			})

			client.on('close', () => {
				resolve()
			})

			setTimeout(() => {
				client.destroy()
				reject(new Error('IPC 通信超时'))
			}, 5000)
		})
	}
}
