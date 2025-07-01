import { Buffer } from 'node:buffer'
import os from 'node:os'
import process from 'node:process'

const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash'

async function spawnShell() {
	const pty = await import('npm:@homebridge/node-pty-prebuilt-multiarch')
	return pty.spawn(shell, [], {
		name: 'xterm-color',
		cols: 80, // Default, can be resized
		rows: 30, // Default, can be resized
		cwd: os.homedir(), // Use os.homedir() for better platform compatibility
		env: process.env,
		useConpty: false, // Force winpty backend to avoid os error 87
	})
}

export async function handleTerminalConnection(ws) {
	const ptyProcess = await spawnShell()
	ws.on('message', (message) => {
		try {
			let inputData = ''
			if (typeof message === 'string') inputData = message
			else if (Buffer.isBuffer(message)) inputData = message.toString('utf-8')
			else return console.warn('Received non-string/buffer WebSocket message:', message)

			ptyProcess.write(inputData)
		} catch (error) {
			console.error('Error handling WebSocket message:', error)
		}
	})

	ptyProcess.on('data', (data) => {
		try {
			ws.send(data)
		} catch (error) {
			console.error('Error sending data to WebSocket:', error)
		}
	})

	ptyProcess.on('exit', (code) => {
		console.log('PTY process exited with code:', code)
		ws.close()
	})

	ws.on('close', () => {
		ptyProcess.kill()
	})

	ws.on('error', (error) => {
		console.error('WebSocket error:', error)
		ptyProcess.kill()
	})
}