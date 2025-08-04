import { applyTheme } from '../../scripts/theme.mjs'
applyTheme()

import { initTranslations, geti18n, console } from '../../scripts/i18n.mjs'
import { setTerminal } from '../../scripts/terminal.mjs'

const terminal = setTerminal(document.getElementById('terminal'))

await initTranslations('terminal_assistant')
terminal.writeln(geti18n('terminal_assistant.initialMessage'))
terminal.writeln(`\x1b]8;;https://github.com/steve02081504/fount-pwsh\x07${geti18n('terminal_assistant.initialMessageLink')}\x1b]8;;\x07`)

let remoteSocket = null
let isRemoteSessionActive = false
let dataListenerDisposable = null
let resizeListenerDisposable = null
const RECONNECT_DELAY = 5000 // 5 seconds

function sendRemoteSocketMessage(payload) {
	if (remoteSocket && remoteSocket.readyState === WebSocket.OPEN)
		remoteSocket.send(JSON.stringify(payload))
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
}

function clearRemoteSessionHandlers() {
	if (dataListenerDisposable) dataListenerDisposable.dispose()
	if (resizeListenerDisposable) resizeListenerDisposable.dispose()
	dataListenerDisposable = null
	resizeListenerDisposable = null
}

function connectRemoteTerminal() {
	if (isRemoteSessionActive || (remoteSocket && remoteSocket.readyState === WebSocket.CONNECTING))
		return

	const socketProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
	const socketUrl = `${socketProtocol}//${window.location.host}/ws/shells/shellassist/terminal`

	remoteSocket = new WebSocket(socketUrl)

	remoteSocket.onopen = () => {
		isRemoteSessionActive = true
		setupRemoteSessionHandlers()
		sendRemoteSocketMessage({ type: 'resize', data: { cols: terminal.cols, rows: terminal.rows } })
	}

	remoteSocket.onmessage = (event) => {
		if (!terminal.element) return
		terminal.write(event.data)
	}

	const handleDisconnect = (eventMessage) => {
		if (!isRemoteSessionActive && remoteSocket?.readyState !== WebSocket.CONNECTING && remoteSocket?.readyState !== WebSocket.OPEN)
			return
		isRemoteSessionActive = false
		clearRemoteSessionHandlers()

		if (remoteSocket) {
			remoteSocket.onopen = null
			remoteSocket.onmessage = null
			remoteSocket.onerror = null
			remoteSocket.onclose = null
			remoteSocket = null
		}

		setTimeout(connectRemoteTerminal, RECONNECT_DELAY)
	}

	remoteSocket.onerror = (error) => {
		console.error('Remote WebSocket error:', error)
		handleDisconnect('Connection error.')
	}

	remoteSocket.onclose = (event) => {
		console.log('Remote WebSocket closed:', event)
		handleDisconnect(`Connection closed (Code: ${event.code}).`)
	}
}

connectRemoteTerminal()
