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
	})
}

export async function handleTerminalConnection(ws) {
	const ptyProcess = await spawnShell()
	ws.on('message', (message) => {
		try {
			let inputData = ''
			if (Object(message) instanceof String) inputData = message
			else if (Buffer.isBuffer(message)) inputData = message.toString('utf-8')
			else return console.warn('Received non-string/buffer WebSocket message:', message)

			// Assuming client always sends JSON strings
			const parsedMessage = JSON.parse(inputData)
			if (parsedMessage.type === 'resize')
				ptyProcess.resize(parsedMessage.data.cols, parsedMessage.data.rows)
			else if (parsedMessage.type === 'data')
				ptyProcess.write(parsedMessage.data)
			else
				console.warn('Received valid JSON but with unexpected type:', parsedMessage)
		} catch (e) {
			console.error('Failed to parse client message as JSON, or error in processing:', e)
		}
	})

	ptyProcess.on('data', (data) => {
		if (ws.readyState === ws.OPEN) ws.send(data)
	})

	ws.on('close', () => { ptyProcess.kill() })

	ws.on('error', (error) => {
		console.error('WebSocket error for shellassist terminal:', error)
		ptyProcess.kill()
	})
}
