/**
 * Subfounts UI main logic - WebSocket-based updates only
 * All PeerJS connections are handled server-side to avoid ID conflicts
 */
import { initTranslations, setLocalizeLogic } from '/scripts/i18n.mjs'
import { applyTheme } from '/scripts/theme.mjs'
import { showToastI18n } from '/scripts/toast.mjs'

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
		showToastI18n('error', 'subfounts.errors.loadConnectionCodeFailed', { message: error.message })
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
		showToastI18n('success', 'subfounts.hostConnectionCode.regenerateSuccess')
	}
	catch (error) {
		console.error('Error regenerating connection code:', error)
		showToastI18n('error', 'subfounts.errors.regenerateConnectionCodeFailed', { message: error.message })
	}
}

/**
 * Renders the list of connected subfounts.
 * @param {Array<object>} subfounts - Array of subfount info objects.
 */
function renderSubfounts(subfounts) {
	subfountsList.innerHTML = ''
	if (!subfounts?.length) {
		const emptyMessage = document.createElement('p')
		emptyMessage.className = 'text-center text-gray-500'
		emptyMessage.setAttribute('data-i18n', 'subfounts.connectedSubfounts.noSubfountsConnected')
		subfountsList.appendChild(emptyMessage)
		return
	}

	const table = document.createElement('table')
	table.className = 'table table-zebra'
	const thead = document.createElement('thead')
	const headerRow = document.createElement('tr')
	
	const headerKeys = [
		'subfounts.connectedSubfounts.table.id',
		'subfounts.connectedSubfounts.table.peerId',
		'subfounts.connectedSubfounts.table.connectedAt',
		'subfounts.connectedSubfounts.table.status',
	]
	
	for (const key of headerKeys) {
		const th = document.createElement('th')
		th.setAttribute('data-i18n', key)
		headerRow.appendChild(th)
	}
	
	thead.appendChild(headerRow)
	
	const tbody = document.createElement('tbody')
	for (const subfount of subfounts) {
		const tr = document.createElement('tr')
		
		// ID cell
		const idCell = document.createElement('td')
		idCell.textContent = subfount.id
		tr.appendChild(idCell)
		
		// Peer ID cell
		const peerIdCell = document.createElement('td')
		peerIdCell.className = 'font-mono text-sm'
		if (subfount.peerId) 
			peerIdCell.textContent = subfount.peerId
		
		else 
			peerIdCell.setAttribute('data-i18n', 'subfounts.connectedSubfounts.table.na')
		
		tr.appendChild(peerIdCell)
		
		// Connected At cell
		const connectedAtCell = document.createElement('td')
		if (subfount.connectedAt) 
			setLocalizeLogic(connectedAtCell, () => {
				connectedAtCell.textContent = new Date(subfount.connectedAt).toLocaleString()
			})
		
		else 
			connectedAtCell.setAttribute('data-i18n', 'subfounts.connectedSubfounts.table.na')
		
		tr.appendChild(connectedAtCell)
		
		// Status cell
		const statusCell = document.createElement('td')
		const statusBadge = document.createElement('span')
		statusBadge.className = subfount.isConnected ? 'badge badge-success' : 'badge badge-error'
		statusBadge.setAttribute('data-i18n', subfount.isConnected 
			? 'subfounts.connectedSubfounts.table.connected' 
			: 'subfounts.connectedSubfounts.table.disconnected')
		statusCell.appendChild(statusBadge)
		tr.appendChild(statusCell)
		
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
		subfountsList.innerHTML = ''
		const errorMessage = document.createElement('p')
		errorMessage.className = 'text-error'
		errorMessage.setAttribute('data-i18n', 'subfounts.errors.loadSubfountsFailed')
		errorMessage.dataset.message = error.message
		subfountsList.appendChild(errorMessage)
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
		.then(() => showToastI18n('success', 'subfounts.hostConnectionCode.connectionCodeCopied'))
		.catch(e => showToastI18n('error', 'subfounts.errors.generalError', { message: e.message }))
})

copyPasswordButton.addEventListener('click', () => {
	navigator.clipboard.writeText(password)
		.then(() => showToastI18n('success', 'subfounts.hostConnectionCode.passwordCopied'))
		.catch(e => showToastI18n('error', 'subfounts.errors.generalError', { message: e.message }))
})

regenerateButton.addEventListener('click', regenerateConnectionCode)

/**
 * Main initialization function.
 */
async function main() {
	await initTranslations('subfounts')
	applyTheme()
	await loadConnectionCode()
	await loadSubfounts()
	connectWebSocket()
}

main()
