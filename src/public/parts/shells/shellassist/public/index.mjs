/**
 * 终端助手 shell 的客户端逻辑。
 */
import { initTranslations, geti18n, console } from '../../scripts/i18n.mjs'
import { setTerminal } from '../../scripts/terminal.mjs'
import { applyTheme } from '../../scripts/theme.mjs'

applyTheme()
await initTranslations('terminal_assistant')

const terminal = setTerminal(document.getElementById('terminal'))

terminal.writeln(geti18n('terminal_assistant.initialMessage'))
terminal.writeln(`\x1b]8;;https://github.com/steve02081504/fount-pwsh\x07${geti18n('terminal_assistant.initialMessageLink')}\x1b]8;;\x07`)

let remoteSocket = null
let isRemoteSessionActive = false
let dataListenerDisposable = null
let resizeListenerDisposable = null
const RECONNECT_DELAY = 5000 // 5 seconds

/**
 * 发送远程套接字消息。
 * @param {any} payload - 负载。
 */
function sendRemoteSocketMessage(payload) {
	if (remoteSocket && remoteSocket.readyState === WebSocket.OPEN)
		remoteSocket.send(JSON.stringify(payload))
}

/**
 * 设置远程会话处理程序。
 */
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

/**
 * 清除远程会话处理程序。
 */
function clearRemoteSessionHandlers() {
	if (dataListenerDisposable) dataListenerDisposable.dispose()
	if (resizeListenerDisposable) resizeListenerDisposable.dispose()
	dataListenerDisposable = null
	resizeListenerDisposable = null
}

/**
 * 连接远程终端。
 */
function connectRemoteTerminal() {
	if (isRemoteSessionActive || (remoteSocket && remoteSocket.readyState === WebSocket.CONNECTING))
		return

	const socketProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
	const socketUrl = `${socketProtocol}//${window.location.host}/ws/parts/shells:shellassist/terminal`

	remoteSocket = new WebSocket(socketUrl)

	/**
	 * WebSocket 'open' 事件处理程序。
	 */
	remoteSocket.onopen = () => {
		isRemoteSessionActive = true
		setupRemoteSessionHandlers()
		sendRemoteSocketMessage({ type: 'resize', data: { cols: terminal.cols, rows: terminal.rows } })
	}

	/**
	 * WebSocket 'message' 事件处理程序。
	 * @param {MessageEvent} event - WebSocket 消息事件。
	 */
	remoteSocket.onmessage = event => {
		if (!terminal.element) return
		terminal.write(event.data)
	}

	/**
	 * 处理断开连接。
	 * @param {string} eventMessage - 事件消息。
	 */
	const handleDisconnect = eventMessage => {
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

	/**
	 * WebSocket 'error' 事件处理程序。
	 * @param {Event} error - WebSocket 错误事件。
	 */
	remoteSocket.onerror = error => {
		console.error('Remote WebSocket error:', error)
		handleDisconnect('Connection error.')
	}

	/**
	 * WebSocket 'close' 事件处理程序。
	 * @param {CloseEvent} event - WebSocket 关闭事件。
	 */
	remoteSocket.onclose = event => {
		console.log('Remote WebSocket closed:', event)
		handleDisconnect(`Connection closed (Code: ${event.code}).`)
	}
}

connectRemoteTerminal()
