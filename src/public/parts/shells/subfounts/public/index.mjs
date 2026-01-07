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
	placeholderOption.dataset.i18n = 'subfounts.codeExecution.selectSubfountPlaceholder'
	subfountSelect.appendChild(placeholderOption)

	// Add subfount options
	for (const subfount of subfounts) {
		const option = document.createElement('option')
		option.value = subfount.id.toString()
		if (subfount.id === 0) {
			option.dataset.i18n = 'subfounts.codeExecution.hostOption'
			option.dataset.id = subfount.id.toString()
		}
		else {
			option.dataset.i18n = 'subfounts.codeExecution.subfountOption'
			option.dataset.id = subfount.id.toString()
			option.dataset.deviceId = subfount.deviceId && subfount.deviceId !== subfount.id.toString() ? ` (${subfount.deviceId})` : ''
		}
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
		emptyMessage.dataset.i18n = 'subfounts.connectedSubfounts.noSubfountsConnected'
		subfountsList.appendChild(emptyMessage)
		return
	}

	const table = document.createElement('table')
	table.className = 'table table-zebra'
	const thead = document.createElement('thead')
	const headerRow = document.createElement('tr')

	const headerKeys = [
		'subfounts.connectedSubfounts.table.id',
		'subfounts.connectedSubfounts.table.description',
		'subfounts.connectedSubfounts.table.deviceId',
		'subfounts.connectedSubfounts.table.connectedAt',
		'subfounts.connectedSubfounts.table.status',
		'subfounts.connectedSubfounts.table.actions',
	]

	for (const key of headerKeys) {
		const th = document.createElement('th')
		th.dataset.i18n = key
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

		// Description cell (editable)
		const descriptionCell = document.createElement('td')
		const descriptionInput = document.createElement('input')
		descriptionInput.type = 'text'
		descriptionInput.className = 'input input-sm input-bordered w-full'
		descriptionInput.value = subfount.description || ''
		descriptionInput.placeholder = subfount.id === 0 ? 'localhost' : ''
		descriptionCell.appendChild(descriptionInput)
		tr.appendChild(descriptionCell)

		// Device ID cell
		const deviceIdCell = document.createElement('td')
		deviceIdCell.className = 'font-mono text-sm'
		if (subfount.deviceId)
			deviceIdCell.textContent = subfount.deviceId
		else
			deviceIdCell.dataset.i18n = 'subfounts.connectedSubfounts.table.na'
		tr.appendChild(deviceIdCell)

		// Connected At cell
		const connectedAtCell = document.createElement('td')
		if (subfount.connectedAt)
			setLocalizeLogic(connectedAtCell, () => {
				connectedAtCell.textContent = new Date(subfount.connectedAt).toLocaleString()
			})
		else
			connectedAtCell.dataset.i18n = 'subfounts.connectedSubfounts.table.na'
		tr.appendChild(connectedAtCell)

		// Status cell
		const statusCell = document.createElement('td')
		const statusBadge = document.createElement('span')
		statusBadge.className = subfount.isConnected ? 'badge badge-success' : 'badge badge-error'
		statusBadge.dataset.i18n = subfount.isConnected
			? 'subfounts.connectedSubfounts.table.connected'
			: 'subfounts.connectedSubfounts.table.disconnected'
		statusCell.appendChild(statusBadge)
		tr.appendChild(statusCell)

		// Actions cell
		const actionsCell = document.createElement('td')
		const saveButton = document.createElement('button')
		saveButton.className = 'btn btn-sm btn-primary'
		saveButton.dataset.i18n = 'subfounts.connectedSubfounts.table.save'
		saveButton.addEventListener('click', async () => {
			const newDescription = descriptionInput.value.trim()
			try {
				const response = await fetch('/api/parts/shells:subfounts/set-description', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						deviceId: subfount.id,
						description: newDescription || null,
					}),
				})
				if (!response.ok) throw new Error('Failed to save description')
				showToastI18n('success', 'subfounts.connectedSubfounts.descriptionSaved')
			}
			catch (error) {
				console.error('Error saving description:', error)
				showToastI18n('error', 'subfounts.connectedSubfounts.descriptionSaveFailed', { message: error.message })
			}
		})
		actionsCell.appendChild(saveButton)
		tr.appendChild(actionsCell)

		tbody.appendChild(tr)
	}
	table.appendChild(thead)
	table.appendChild(tbody)
	subfountsList.appendChild(table)
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
	 * WebSocket 关闭处理程序。
	 */
	ws.onclose = () => {
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
	executeButton.dataset.i18n = 'subfounts.codeExecution.executing'
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
			const errorData = await response.json().catch(() => ({}))
			throw new Error(errorData.error || '执行失败')
		}

		const data = await response.json()

		// 显示结果
		executionResult.classList.remove('hidden')
		resultAlert.className = 'alert alert-success'
		resultContent.textContent = JSON.stringify(data.result, null, '\t')

		showToastI18n('success', 'subfounts.codeExecution.executionSuccess')
	}
	catch (error) {
		executionResult.classList.remove('hidden')
		resultAlert.className = 'alert alert-error'
		resultContent.textContent = error.message || '执行出错'
		showToastI18n('error', 'subfounts.codeExecution.executionFailed', { message: error.message })
	}
	finally {
		executeButton.disabled = false
		executeButton.dataset.i18n = 'subfounts.codeExecution.executeButton'
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
	connectWebSocket()
}

main()
