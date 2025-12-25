/**
 * Subfounts UI main logic - WebSocket-based updates only
 * All PeerJS connections are handled server-side to avoid ID conflicts
 */
import { applyTheme } from '/scripts/theme.mjs'
import { showToast } from '/scripts/toast.mjs'

const connectionCodeInput = document.getElementById('connection-code-input')
const passwordInput = document.getElementById('password-input')
const copyCodeButton = document.getElementById('copy-code-button')
const copyPasswordButton = document.getElementById('copy-password-button')
const regenerateButton = document.getElementById('regenerate-button')
const subfountsList = document.getElementById('subfounts-list')

let connectionCode = null
let password = null

/**
 * Loads the connection code from the server.
 */
async function loadConnectionCode() {
	try {
		const response = await fetch('/api/parts/shells:subfounts/connection-code')
		if (!response.ok) throw new Error('Failed to load connection code')
		const data = await response.json()
		connectionCode = data.peerId
		password = data.password
		connectionCodeInput.value = connectionCode
		passwordInput.value = password
	}
	catch (error) {
		console.error('Error loading connection code:', error)
		showToast('error', `Failed to load connection code: ${error.message}`)
	}
}

/**
 * Regenerates the connection code.
 */
async function regenerateConnectionCode() {
	try {
		const response = await fetch('/api/parts/shells:subfounts/regenerate-code', { method: 'POST' })
		if (!response.ok) throw new Error('Failed to regenerate connection code')
		const data = await response.json()
		connectionCode = data.peerId
		password = data.password
		connectionCodeInput.value = connectionCode
		passwordInput.value = password
		showToast('success', 'Connection code regenerated')
	}
	catch (error) {
		console.error('Error regenerating connection code:', error)
		showToast('error', `Failed to regenerate connection code: ${error.message}`)
	}
}

/**
 * Escapes HTML to prevent XSS attacks.
 * @param {string} text - Text to escape.
 * @returns {string} - Escaped text.
 */
function escapeHtml(text) {
	const div = document.createElement('div')
	div.textContent = text
	return div.innerHTML
}

/**
 * Renders the list of connected subfounts.
 * @param {Array<object>} subfounts - Array of subfount info objects.
 */
function renderSubfounts(subfounts) {
	subfountsList.innerHTML = ''
	if (!subfounts?.length) {
		subfountsList.innerHTML = '<p class="text-center text-gray-500">No subfounts connected</p>'
		return
	}

	const table = document.createElement('table')
	table.className = 'table table-zebra'
	const thead = document.createElement('thead')
	thead.innerHTML = `
		<tr>
			<th>ID</th>
			<th>Peer ID</th>
			<th>Connected At</th>
			<th>Status</th>
		</tr>
	`
	const tbody = document.createElement('tbody')
	for (const subfount of subfounts) {
		const tr = document.createElement('tr')
		const connectedAt = subfount.connectedAt ? new Date(subfount.connectedAt).toLocaleString() : 'N/A'
		const status = subfount.isConnected ? '<span class="badge badge-success">Connected</span>' : '<span class="badge badge-error">Disconnected</span>'
		const peerId = subfount.peerId ? escapeHtml(subfount.peerId) : 'N/A'
		tr.innerHTML = `
			<td>${subfount.id}</td>
			<td class="font-mono text-sm">${peerId}</td>
			<td>${escapeHtml(connectedAt)}</td>
			<td>${status}</td>
		`
		tbody.appendChild(tr)
	}
	table.appendChild(thead)
	table.appendChild(tbody)
	subfountsList.appendChild(table)
}

/**
 * Loads the list of connected subfounts.
 */
async function loadSubfounts() {
	try {
		const response = await fetch('/api/parts/shells:subfounts/connected')
		if (!response.ok) throw new Error('Failed to load subfounts')
		const data = await response.json()
		renderSubfounts(data.subfounts)
	}
	catch (error) {
		console.error('Error loading subfounts:', error)
		subfountsList.innerHTML = `<p class="text-error">Failed to load subfounts: ${error.message}</p>`
	}
}

/**
 * Connects to the WebSocket server for real-time updates.
 */
function connectWebSocket() {
	const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
	const wsUrl = `${wsProtocol}//${window.location.host}/ws/parts/shells:subfounts/ui`
	const ws = new WebSocket(wsUrl)

	/**
	 * WebSocket message handler.
	 * @param {MessageEvent} event - WebSocket message event.
	 */
	ws.onmessage = (event) => {
		try {
			const msg = JSON.parse(event.data)
			if (msg.type === 'subfounts_update')
				renderSubfounts(msg.payload)

		}
		catch (error) {
			console.error('Error processing WebSocket message:', error)
		}
	}

	/**
	 *
	 */
	ws.onclose = () => {
		console.log('WebSocket disconnected, reconnecting in 5 seconds...')
		setTimeout(connectWebSocket, 5000)
	}

	/**
	 * WebSocket error handler.
	 * @param {Event} error - WebSocket error event.
	 */
	ws.onerror = (error) => {
		console.error('WebSocket error:', error)
	}
}

// Event listeners
copyCodeButton.addEventListener('click', () => {
	navigator.clipboard.writeText(connectionCode)
		.then(() => showToast('success', 'Connection code copied to clipboard'))
		.catch(e => showToast('error', e.message))
})

copyPasswordButton.addEventListener('click', () => {
	navigator.clipboard.writeText(password)
		.then(() => showToast('success', 'Password copied to clipboard'))
		.catch(e => showToast('error', e.message))
})

regenerateButton.addEventListener('click', regenerateConnectionCode)

/**
 * Main initialization function.
 */
async function main() {
	applyTheme()
	await loadConnectionCode()
	await loadSubfounts()
	connectWebSocket()
}

main()
