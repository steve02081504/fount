import { applyTheme } from '/scripts/theme.mjs'
import { showToastI18n } from '/scripts/toast.mjs'
import { initTranslations } from '/scripts/i18n.mjs'
import { createVirtualList } from '/scripts/virtualList.mjs'
import { renderTemplate, usingTemplates } from '/scripts/template.mjs'
import { onServerEvent } from '/scripts/server_events.mjs'
import { createLogsWs, getAutoUpdateEnabled, getSystemInfo, openSource, postRestart } from './src/endpoints.mjs'

applyTheme()
usingTemplates('/parts/shells:debug_info/templates')
await initTranslations('debug_info')

const versionIndicator = document.getElementById('version-indicator'),
	localVersion = document.getElementById('local-version'),
	remoteVersion = document.getElementById('remote-version'),
	systemInfoTable = document.getElementById('system-info-table'),
	backendChecks = document.getElementById('backend-checks'),
	frontendChecks = document.getElementById('frontend-checks'),
	backendLogList = document.getElementById('backend-log-list'),
	copyBtn = document.getElementById('copy-btn'),
	updateBtn = document.getElementById('update-btn'),
	updateBtnIcon = document.getElementById('update-btn-icon'),
	updateBtnLabel = document.getElementById('update-btn-label')

const debugData = {
	timestamp: new Date().toISOString(),
	version: {},
	system: {},
	connectivity: { backend: [], frontend: [] },
}

let isUpToDate = null
let autoUpdateEnabled = false
let canOpenEditor = false
const logsStore = []
let logsVirtualList = null
let logsWs = null

/**
 * 将字节数转换为 GiB。
 * @param {number} bytes - 字节数。
 * @returns {string} 以 GiB 为单位保留两位小数的字符串。
 */
const bytesToGiB = bytes => (bytes / 1024 ** 3).toFixed(2)

/**
 * 获取版本信息并更新 UI。
 */
async function fetchVersionInfo() {
	try {
		const localRes = await fetch('/api/ping')
		const localVer = (await localRes.json()).ver
		localVersion.textContent = localVer
		debugData.version.local = localVer

		const remoteRes = await fetch('https://api.github.com/repos/steve02081504/fount/commits/master', { cache: 'no-cache' })
		const { sha: remoteVer } = await remoteRes.json()
		remoteVersion.textContent = remoteVer
		debugData.version.remote = remoteVer

		isUpToDate = localVer === remoteVer
		versionIndicator.className = `badge badge-lg ${isUpToDate ? 'badge-success' : 'badge-error'} gap-2`
		versionIndicator.dataset.i18n = isUpToDate ? 'debug_info.versionStatus.upToDate' : 'debug_info.versionStatus.outdated'
	} catch (error) {
		console.error('Version check failed:', error)
		versionIndicator.className = 'badge badge-lg badge-warning gap-2'
		versionIndicator.dataset.i18n = 'debug_info.versionStatus.checkFailed'
		isUpToDate = null
	}
	refreshUpdateBtn()
}

onServerEvent('server-updated', () => { fetchVersionInfo(); fetchSystemInfo() })
onServerEvent('server-reconnected', () => { fetchVersionInfo(); fetchSystemInfo() })

/**
 * 获取系统信息并更新 UI。
 */
async function fetchSystemInfo() {
	try {
		const data = await getSystemInfo()
		debugData.system = data

		const { os, cpu, memory, connectivity } = data
		const rows = [
			{ key: 'OS', val: `${os.platform} ${os.release} (${os.arch})` },
			{ key: 'CPU', val: `${cpu.model} (${cpu.cores} cores) @ ${cpu.speed}MHz` },
			{ key: 'Memory', val: `Total: ${bytesToGiB(memory.total)} GB / Free: ${bytesToGiB(memory.free)} GB` },
		]

		systemInfoTable.innerHTML = ''
		systemInfoTable.appendChild(await renderTemplate('system_info_table', { rows }))

		debugData.connectivity.backend = connectivity
		backendChecks.innerHTML = ''
		backendChecks.appendChild(await renderTemplate('connectivity_list', { checks: connectivity }))
	} catch (error) {
		console.error('System info fetch failed:', error)
		systemInfoTable.innerHTML = '<tr><td colspan="2" class="text-error text-center" data-i18n="debug_info.systemInfo.failed"></td></tr>'
	}
}

/**
 * 检查前端连接性并更新 UI。
 */
async function checkFrontendConnectivity() {
	const checks = [
		{ id: 'check-fount-server', name: 'fount Server', url: '/api/ping' },
		{ id: 'check-esm', name: 'esm.sh', url: 'https://esm.sh' },
		{ id: 'check-jsdelivr', name: 'jsDelivr', url: 'https://cdn.jsdelivr.net' },
		{ id: 'check-iconify', name: 'Iconify', url: 'https://api.iconify.design' },
		{ id: 'check-fount-public', name: 'fount Public', url: 'https://steve02081504.github.io/fount' }
	]

	frontendChecks.innerHTML = ''
	frontendChecks.appendChild(await renderTemplate('connectivity_list', { checks }))

	for (const check of checks) {
		const start = Date.now()
		let status = 'error', duration = 0
		try {
			await fetch(check.url, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' })
			status = 'ok'
			duration = Date.now() - start
		} catch { /* unreachable */ }
		debugData.connectivity.frontend.push({ ...check, status, duration })
		document.getElementById(check.id).replaceWith(await renderTemplate('connectivity_item', { ...check, status, duration }))
	}
}

const UPDATE_ICON = 'https://api.iconify.design/line-md/update.svg'
const LOADING_ICON = 'https://api.iconify.design/line-md/loading-twotone-loop.svg'
const UPTODATE_ICON = 'https://api.iconify.design/line-md/confirm.svg'

/**
 * 根据当前版本状态和自动更新配置刷新更新按钮的样式与可用性。
 */
function refreshUpdateBtn() {
	const upToDate = isUpToDate === true
	updateBtn.disabled = !(isUpToDate === false && autoUpdateEnabled)
	if (updateBtnIcon) updateBtnIcon.src = upToDate ? UPTODATE_ICON : UPDATE_ICON
	if (updateBtnLabel) updateBtnLabel.dataset.i18n = upToDate ? 'debug_info.alreadyLatest' : 'debug_info.updateNow'
}

/**
 * 将更新按钮切换为"重启中"状态（禁用并显示加载图标）。
 */
function setUpdateBtnRestarting() {
	updateBtn.disabled = true
	if (updateBtnIcon) updateBtnIcon.src = LOADING_ICON
	if (updateBtnLabel) updateBtnLabel.dataset.i18n = 'debug_info.updateRestarting'
}

/**
 * 从服务器获取自动更新启用状态并刷新更新按钮。
 */
async function fetchAutoUpdateStatus() {
	try {
		const data = await getAutoUpdateEnabled()
		autoUpdateEnabled = data.enabled
	} catch {
		autoUpdateEnabled = false
	}
	refreshUpdateBtn()
}

/**
 * 转义 HTML 文本。
 * @param {string} str - 原始文本。
 * @returns {string} - 转义后的 HTML 文本。
 */
function escapeHtml(str) {
	return String(str).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

/**
 * 渲染序列化参数树。
 * @param {{kind: string, value?: any, entries?: Array<{key: string, value: object}>, items?: Array<object>}} node - 参数树节点。
 * @returns {string} - 渲染后的 HTML 字符串。
 */
function renderSerializedArg(node) {
	switch (node?.kind) {
		case 'string':
		case 'number':
		case 'boolean':
		case 'bigint':
		case 'symbol':
		case 'function':
			return `<span class="text-info">${escapeHtml(node.value)}</span>`
		case 'null':
			return '<span class="opacity-60">null</span>'
		case 'undefined':
			return '<span class="opacity-60">undefined</span>'
		case 'circular':
			return '<span class="text-warning">[Circular]</span>'
		case 'array':
			return `<details class="collapse collapse-arrow bg-base-100">
				<summary class="collapse-title py-1 min-h-0 text-sm">Array(${node.items?.length || 0})</summary>
				<div class="collapse-content text-xs space-y-1">${(node.items || []).map((item, i) => `
					<div><span class="opacity-60 mr-1">[${i}]</span>${renderSerializedArg(item)}</div>
				`).join('')}</div>
			</details>`
		default:
			return `<details class="collapse collapse-arrow bg-base-100">
				<summary class="collapse-title py-1 min-h-0 text-sm">${escapeHtml(node?.kind || 'object')}</summary>
				<div class="collapse-content text-xs space-y-1">${(node.entries || []).map(entry => `
					<div><span class="opacity-60 mr-1">${escapeHtml(entry.key)}:</span>${renderSerializedArg(entry.value)}</div>
				`).join('')}</div>
			</details>`
	}
}

/**
 * 渲染单条日志项。
 * @param {object} entry - 日志条目。
 * @returns {HTMLElement} - 日志项元素。
 */
function renderLogItem(entry) {
	const wrap = document.createElement('article')
	wrap.className = 'card bg-base-100 border border-base-300 shadow-sm mb-2'
	const timestamp = new Date(entry.timestamp).toLocaleString()
	const locationText = entry.callsite
		? `${entry.callsite.filePath}:${entry.callsite.line}:${entry.callsite.column}`
		: ''
	const canClickLocation = Boolean(canOpenEditor && entry.callsite?.filePath)
	const argsHtml = entry.args?.length
		? entry.args.map((arg, i) => `
			<div class="mt-1">
				<div class="text-[10px] opacity-60">arg[${i}]</div>
				${renderSerializedArg(arg)}
			</div>`).join('')
		: ''
	wrap.innerHTML = `
		<div class="card-body p-3">
			<div class="flex justify-between items-start gap-2">
				<div class="badge badge-sm">${escapeHtml(entry.level || 'log')}</div>
				<button type="button" class="btn btn-xs btn-ghost font-mono max-w-[55%] truncate ${canClickLocation ? '' : 'btn-disabled'}" title="${escapeHtml(locationText)}">
					${escapeHtml(locationText || '-')}
				</button>
			</div>
			<div class="text-xs opacity-60">${escapeHtml(timestamp)}</div>
			<div class="prose prose-sm max-w-none break-all">${entry.html || escapeHtml(entry.text || '')}</div>
			${argsHtml ? `<div class="divider my-1"></div><div>${argsHtml}</div>` : ''}
		</div>
	`
	const locationBtn = wrap.querySelector('button')
	if (canClickLocation && locationBtn)
		locationBtn.addEventListener('click', async () => {
			const result = await openSource(entry.callsite.filePath, entry.callsite.line, entry.callsite.column)
			if (!result.success)
				showToastI18n('error', 'debug_info.logs.openSourceFailed', { message: result.message || 'failed' })
		})
	return wrap
}

/**
 * 初始化日志虚拟列表。
 * @returns {void}
 */
function initLogsVirtualList() {
	if (logsVirtualList) logsVirtualList.destroy()
	/**
	 * 获取日志分片数据。
	 * @param {number} offset - 起始偏移。
	 * @param {number} limit - 最大条数。
	 * @returns {Promise<{items: Array<object>, total: number}>} - 分片数据与总数。
	 */
	const fetchLogSlice = async (offset, limit) => ({
		items: logsStore.slice(offset, limit ? offset + limit : undefined),
		total: logsStore.length,
	})
	/**
	 * 渲染日志条目。
	 * @param {object} item - 日志条目对象。
	 * @returns {HTMLElement} - 渲染结果元素。
	 */
	const renderLogEntry = (item) => renderLogItem(item)
	logsVirtualList = createVirtualList({
		container: backendLogList,
		fetchData: fetchLogSlice,
		renderItem: renderLogEntry,
		initialIndex: logsStore.length ? logsStore.length - 1 : 0,
	})
}

/**
 * 建立后台日志 WS 连接。
 * @returns {void}
 */
function connectLogsWs() {
	if (logsWs && (logsWs.readyState === WebSocket.OPEN || logsWs.readyState === WebSocket.CONNECTING)) return
	logsWs = createLogsWs()
	/**
	 * 处理日志 WS 消息。
	 * @param {MessageEvent<string>} event - WS 消息事件。
	 * @returns {Promise<void>}
	 */
	logsWs.onmessage = async (event) => {
		const payload = JSON.parse(event.data)
		if (payload.type === 'snapshot') {
			logsStore.length = 0
			logsStore.push(...payload.entries || [])
			canOpenEditor = Boolean(payload.canOpenEditor)
			initLogsVirtualList()
			return
		}
		if (payload.type === 'append' && payload.entry) {
			logsStore.push(payload.entry)
			const nearBottom = Math.abs((backendLogList.scrollHeight - backendLogList.scrollTop) - backendLogList.clientHeight) < 64
			if (logsVirtualList)
				await logsVirtualList.appendItem(payload.entry, nearBottom)
		}
	}
	/**
	 * WS 关闭后重连。
	 * @returns {number} - 定时器 ID。
	 */
	logsWs.onclose = () => setTimeout(connectLogsWs, 1500)
}

copyBtn.addEventListener('click', () => {
	const { timestamp, version, system, connectivity } = debugData
	const { os, cpu, memory } = system
	const report = `\
fount Debug Report
==================
Timestamp: ${timestamp}

Version Status
--------------
Local: ${version.local || 'Unknown'}
Remote: ${version.remote || 'Unknown'}
Status: ${versionIndicator.textContent}

System Information
------------------
OS: ${os?.platform} ${os?.release} (${os?.arch})
CPU: ${cpu?.model}
Memory: Total ${bytesToGiB(memory?.total)} GB / Free ${bytesToGiB(memory?.free)} GB

Backend Connectivity
--------------------
${connectivity.backend.map(check => `${check.name}: ${check.status} (${check.duration || 0}ms)`).join('\n')}

Frontend Connectivity
---------------------
${connectivity.frontend.map(check => `${check.name}: ${check.status} (${check.duration || 0}ms)`).join('\n')}`

	navigator.clipboard.writeText(report)
		.then(() => showToastI18n('success', 'debug_info.copySuccess'))
		.catch(() => showToastI18n('error', 'debug_info.copyFailed'))
})

updateBtn.addEventListener('click', async () => {
	updateBtn.disabled = true
	try {
		const { ok, data } = await postRestart()
		if (ok) {
			setUpdateBtnRestarting()
			showToastI18n('success', 'debug_info.updateSuccess')
		} else if (data.error === 'auto_update_disabled') {
			showToastI18n('warning', 'debug_info.autoUpdateNotEnabled')
			await fetchAutoUpdateStatus()
		} else {
			showToastI18n('error', 'debug_info.updateFailed')
			refreshUpdateBtn()
		}
	} catch {
		showToastI18n('error', 'debug_info.updateFailed')
		refreshUpdateBtn()
	}
})

const VERSION_POLL_INTERVAL = 5 * 60 * 1000
let lastVersionCheckTime = 0
let pollTimer = null

/**
 * 执行一次版本轮询并记录检查时间戳。
 */
async function pollVersionInfo() {
	lastVersionCheckTime = Date.now()
	await fetchVersionInfo()
}

/**
 * 启动定期版本轮询计时器（若未运行）。
 */
function startPollTimer() {
	if (pollTimer) return
	pollTimer = setInterval(pollVersionInfo, VERSION_POLL_INTERVAL)
}

/**
 * 停止定期版本轮询计时器。
 */
function stopPollTimer() {
	clearInterval(pollTimer)
	pollTimer = null
}

document.addEventListener('visibilitychange', () => {
	if (document.hidden)
		stopPollTimer()
	else {
		if (Date.now() - lastVersionCheckTime >= VERSION_POLL_INTERVAL) pollVersionInfo()
		startPollTimer()
	}
})

if (!document.hidden) startPollTimer()

pollVersionInfo()
fetchSystemInfo()
checkFrontendConnectivity()
fetchAutoUpdateStatus()
connectLogsWs()
