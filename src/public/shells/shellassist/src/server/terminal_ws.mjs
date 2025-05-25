import os from 'node:os'
import pty from 'npm:node-pty'
import { Buffer } from 'node:buffer'

const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash'

function spawnShell() {
	return pty.spawn(shell, [], {
		name: 'xterm-color',
		cols: 80, // Default, can be resized
		rows: 30, // Default, can be resized
		cwd: os.homedir(), // Use os.homedir() for better platform compatibility
		env: process.env,
	})
}

export function handleTerminalConnection(ws) {
	const ptyProcess = spawnShell()

	ws.on('message', (message) => {
		try {
			let inputData = ''
			if (typeof message === 'string') 
				inputData = message
			 else if (Buffer.isBuffer(message)) 
				inputData = message.toString('utf-8')
			 else {
				console.warn('Received non-string/buffer WebSocket message:', message)
				return // Ignore if not string or buffer
			}

			// Assuming client always sends JSON strings
			const parsedMessage = JSON.parse(inputData)
			if (parsedMessage.type === 'resize' && parsedMessage.data &&
				typeof parsedMessage.data.cols === 'number' && typeof parsedMessage.data.rows === 'number') 
				ptyProcess.resize(parsedMessage.data.cols, parsedMessage.data.rows)
			 else if (parsedMessage.type === 'data' && typeof parsedMessage.data === 'string') 
				ptyProcess.write(parsedMessage.data)
			 else 
				console.warn('Received valid JSON but with unexpected type or missing data:', parsedMessage)
			
		} catch (e) {
			console.error('Failed to parse client message as JSON, or error in processing:', e)
		}
	})

	ptyProcess.on('data', (data) => {
		if (ws.readyState === ws.OPEN)  // Ensure WebSocket is still open before sending
			ws.send(data) // Send raw data from PTY to client
		
	})

	ws.on('close', () => {
		console.log(`WebSocket connection closed for shellassist terminal, user: ${user.username}`)
		ptyProcess.kill()
	})

	ws.on('error', (error) => {
		console.error(`WebSocket error for shellassist terminal, user ${user.username}:`, error)
		ptyProcess.kill()
	})

	// Send initial status message
	if (ws.readyState === ws.OPEN) 
		ws.send(JSON.stringify({ type: 'status', message: 'PTY session started via WssRouter' }))
	
}

export function initTerminalWebsocket(wss) {
	wss.on('connection', handleTerminalConnection)
}
