import process from 'node:process'
import { console } from '../scripts/console.mjs'
import { init } from './server.mjs'
import { IPCManager } from './ipc_server.mjs'
import { ReStartJobs } from './jobs.mjs'

console.log('standing by...')

let args = process.argv.slice(2)

const isFirstInstance = await init()

if (args.length) {
	const command = args[0]
	args = args.slice(1)

	if (command === 'runshell') {
		const username = args[0]
		const shellname = args[1]
		args = args.slice(2)

		try {
			await IPCManager.sendCommand('runshell', { username, shellname, args })
		} catch (err) {
			console.error('发送命令失败：', err)
			process.exit(1)
		}
	}
	else if (command === 'shutdown')
		try {
			await IPCManager.sendCommand('shutdown')
		} catch (err) {
			console.error('发送命令失败：', err)
			process.exit(1)
		}
	else {
		console.error('Invalid command. Use "fount runshell <username> <shellname> <args>".')
		process.exit(1)
	}
}

if (!isFirstInstance) process.exit(0)

ReStartJobs()
