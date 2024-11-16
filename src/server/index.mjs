import process from 'node:process'
import { init } from "./server.mjs"
import { IPCManager } from "./ipc_manager.mjs"

let args = process.argv.slice(2)

const isFirstInstance = await init()

if (args.length) {
	let username = args[0]
	let shellname = args[1]
	args = args.slice(2)

	try {
		await IPCManager.sendCommand('shell', { username, shellname, args })
	} catch (err) {
		console.error('发送命令失败：', err)
		process.exit(1)
	}
}

if (!isFirstInstance) process.exit(0)
