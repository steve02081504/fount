import { applyTheme } from '../../scripts/theme.mjs'
applyTheme()

import { initTranslations, geti18n } from '../../scripts/i18n.mjs'
import { setTerminal } from '../../scripts/terminal.mjs'

const terminal = setTerminal(document.getElementById('terminal'))

let remoteSocket = null
let isRemoteSessionActive = false
let dataListenerDisposable = null
let resizeListenerDisposable = null
let reconnectAttempts = 0
const MAX_RECONNECT_ATTEMPTS = 5
const RECONNECT_DELAY = 5000 // 5 seconds

function sendRemoteSocketMessage(payload) {
	if (remoteSocket && remoteSocket.readyState === WebSocket.OPEN)
		remoteSocket.send(JSON.stringify(payload))
	else
		// Don't writeln here as it might interfere with reconnection messages
		console.warn('Remote socket not open, message not sent:', payload)

}

function setupRemoteSessionHandlers() {
	if (dataListenerDisposable) dataListenerDisposable.dispose()
	dataListenerDisposable = terminal.onData(data => {
		sendRemoteSocketMessage({ type: 'data', data })
	})

	if (resizeListenerDisposable) resizeListenerDisposable.dispose()
	resizeListenerDisposable = terminal.onResize(({ cols, rows }) => {
		sendRemoteSocketMessage({ type: 'resize', data: { cols, rows } })
	})

	// Initial resize message is sent in remoteSocket.onopen
}

function clearRemoteSessionHandlers() {
	if (dataListenerDisposable) dataListenerDisposable.dispose()
	if (resizeListenerDisposable) resizeListenerDisposable.dispose()
	dataListenerDisposable = null
	resizeListenerDisposable = null
	// No local handler to restore to, terminal will just be passive until next connection
}

function connectRemoteTerminal() {
	if (isRemoteSessionActive || (remoteSocket && remoteSocket.readyState === WebSocket.CONNECTING))
		// terminal.writeln('\r\nAlready connected or attempting to connect.'); // Can be noisy
		return


	terminal.writeln('\r\nConnecting to fount remote terminal...')
	// isRemoteSessionActive will be set true on successful open

	const socketProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
	const socketUrl = `${socketProtocol}//${window.location.host}/ws/shells/shellassist/terminal`

	remoteSocket = new WebSocket(socketUrl)

	remoteSocket.onopen = () => {
		terminal.writeln('\r\n[REMOTE SESSION STARTED]')
		console.log('WebSocket connection established for shell terminal.')
		isRemoteSessionActive = true
		reconnectAttempts = 0 // Reset attempts on successful connection
		setupRemoteSessionHandlers()
		sendRemoteSocketMessage({ type: 'resize', data: { cols: terminal.cols, rows: terminal.rows } })
	}

	remoteSocket.onmessage = (event) => {
		// Ensure terminal is still active and visible before writing
		if (!terminal.element) return
		try {
			const message = JSON.parse(event.data)
			if (message.type === 'status')
				terminal.writeln(`\r\n[REMOTE STATUS] ${message.message}`)
			else
				terminal.write(event.data)

		} catch (e) {
			terminal.write(event.data)
		}
	}

	const handleDisconnect = (eventMessage) => {
		if (!isRemoteSessionActive && remoteSocket?.readyState !== WebSocket.CONNECTING && remoteSocket?.readyState !== WebSocket.OPEN)
			// This check is to ensure we only act on disconnects of previously active or currently connecting sessions.
			// If remoteSocket is null (already cleaned up) or in a closed state from a non-active session, do nothing.
			if (!isRemoteSessionActive && reconnectAttempts === 0 && remoteSocket === null) {
				// This means it's likely the initial connection attempt that failed, and error handler already ran.
			} else if (!isRemoteSessionActive && remoteSocket === null)
				// Already handled and cleaned up.
				return


		terminal.writeln(`\r\n[REMOTE SESSION ENDED] ${eventMessage}`)
		isRemoteSessionActive = false // Set to false as session is no longer active
		clearRemoteSessionHandlers() // Clean up terminal listeners

		// Ensure remoteSocket is nulled out only after checking its state and deciding to reconnect.
		// If we are not attempting to reconnect, or if it's already null, this is fine.
		// If a reconnect is scheduled, the old socket object is now irrelevant.
		if (remoteSocket) {
			remoteSocket.onopen = null
			remoteSocket.onmessage = null
			remoteSocket.onerror = null
			remoteSocket.onclose = null
			// Don't close if it's already closed or errored out, could throw.
			// if (remoteSocket.readyState === WebSocket.OPEN || remoteSocket.readyState === WebSocket.CONNECTING) {
			//     remoteSocket.close();
			// }
			remoteSocket = null
		}


		if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
			reconnectAttempts++
			terminal.writeln(`Attempting to reconnect in ${RECONNECT_DELAY / 1000} seconds... (Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`)
			setTimeout(connectRemoteTerminal, RECONNECT_DELAY)
		} else
			terminal.writeln('Maximum reconnect attempts reached. Please refresh the page to try again.')

	}

	remoteSocket.onerror = (error) => {
		console.error('Remote WebSocket error:', error)
		// isRemoteSessionActive might be true or false here.
		// If true, it means an active session errored.
		// If false, it means a connection attempt failed.
		handleDisconnect('Connection error.')
	}

	remoteSocket.onclose = (event) => {
		console.log('Remote WebSocket closed:', event)
		// Similar to onerror, isRemoteSessionActive could be true (closed during active session)
		// or false (closed during connection attempt, e.g. server rejected).
		handleDisconnect(`Connection closed (Code: ${event.code}).`)
	}
}

async function main() {
	await initTranslations('terminal_assistant')
	terminal.writeln(geti18n('terminal_assistant.initialMessage'))
	terminal.writeln(`\x1b]8;;https://github.com/steve02081504/fount-pwsh\x07${geti18n('terminal_assistant.initialMessageLink')}\x1b]8;;\x07`)

	// Directly connect to remote terminal
	connectRemoteTerminal()
}

main()
