/**
 * Subfounts UI 主要逻辑 - 仅限 WebSocket 更新
 * 所有 Trystero 连接都在服务器端处理
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
const subfountSelect = document.getElementById('subfount-select')
const scriptInput = document.getElementById('script-input')
const executeButton = document.getElementById('execute-button')
const executionResult = document.getElementById('execution-result')
const resultAlert = document.getElementById('result-alert')
const resultContent = document.getElementById('result-content')

let connectionCode = null
let password = null
let connectedSubfounts = []

/**
 * 从服务器加载连接代码。
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
 * 重新生成连接代码。
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
 * 更新分机选择下拉菜单。
 * @param {Array<object>} subfounts - 分机信息对象数组。
 */
function updateSubfountSelect(subfounts) {
	// Store current value
	const currentValue = subfountSelect.value
	subfountSelect.innerHTML = ''
	
	// Add placeholder option
	const placeholderOption = document.createElement('option')
	placeholderOption.value = ''
	placeholderOption.setAttribute('data-i18n', 'subfounts.codeExecution.selectSubfountPlaceholder')
	subfountSelect.appendChild(placeholderOption)
	
	// Add subfount options
	for (const subfount of subfounts) {
		const option = document.createElement('option')
		option.value = subfount.id.toString()
		const label = subfount.id === 0 
			? `主机 (ID: ${subfount.id})`
			: `分机 ${subfount.id}${subfount.peerId ? ` (${subfount.peerId})` : ''}`
		option.textContent = label
		subfountSelect.appendChild(option)
	}
	
	// Restore previous selection if still valid
	if (currentValue && subfounts.some(s => s.id.toString() === currentValue))
		subfountSelect.value = currentValue
}

/**
 * 渲染已连接分机列表。
 * @param {Array<object>} subfounts - 分机信息对象数组。
 */
function renderSubfounts(subfounts) {
	connectedSubfounts = subfounts || []
	updateSubfountSelect(connectedSubfounts)
	
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
 * 加载已连接分机列表。
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
 * 连接到 WebSocket 服务器以进行实时更新。
 */
function connectWebSocket() {
	const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
	const wsUrl = `${wsProtocol}//${window.location.host}/ws/parts/shells:subfounts/ui`
	const ws = new WebSocket(wsUrl)

	/**
	 * WebSocket 消息处理程序。
	 * @param {MessageEvent} event - WebSocket 消息事件。
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
	 * WebSocket 错误处理程序。
	 * @param {Event} error - WebSocket 错误事件。
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
 * 在所选分机上执行代码。
 */
async function executeCode() {
	const subfountId = subfountSelect.value
	const script = scriptInput.value.trim()

	if (!subfountId) {
		showToastI18n('error', 'subfounts.codeExecution.noSubfountSelected')
		return
	}

	if (!script) {
		showToastI18n('error', 'subfounts.codeExecution.noScriptProvided')
		return
	}

	executeButton.disabled = true
	executeButton.setAttribute('data-i18n', 'subfounts.codeExecution.executing')
	executionResult.classList.add('hidden')

	try {
		const response = await fetch('/api/parts/shells:subfounts/execute', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				subfountId: parseInt(subfountId, 10),
				script,
			}),
		})

		if (!response.ok) {
			const errorData = await response.json()
			throw new Error(errorData.error || '执行失败')
		}

		const data = await response.json()
		
		// Show result
		executionResult.classList.remove('hidden')
		resultAlert.className = 'alert alert-success'
		resultContent.textContent = JSON.stringify(data.result, null, 2)
		
		showToastI18n('success', 'subfounts.codeExecution.executionSuccess')
	}
	catch (error) {
		console.error('Error executing code:', error)
		executionResult.classList.remove('hidden')
		resultAlert.className = 'alert alert-error'
		resultContent.textContent = error.message || '执行出错'
		showToastI18n('error', 'subfounts.codeExecution.executionFailed', { message: error.message })
	}
	finally {
		executeButton.disabled = false
		executeButton.setAttribute('data-i18n', 'subfounts.codeExecution.executeButton')
	}
}

executeButton.addEventListener('click', executeCode)

/**
 * 主要初始化函数。
 */
async function main() {
	await initTranslations('subfounts')
	applyTheme()
	await loadConnectionCode()
	await loadSubfounts()
	connectWebSocket()
}

main()
