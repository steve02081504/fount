import { applyTheme } from '/scripts/theme.mjs'
import { showToastI18n } from '/scripts/toast.mjs'
import { initTranslations } from '/scripts/i18n.mjs'
import { createVirtualList } from '/scripts/virtualList.mjs'
import { renderTemplate, usingTemplates } from '/scripts/template.mjs'
import { onServerEvent } from '/scripts/server_events.mjs'
import { attachLogWire } from 'https://esm.sh/@steve02081504/virtual-console/wire/client'

import { ping } from '/scripts/endpoints.mjs'
import { renderLogItem, createLogToolbar, entryMatchesFilter } from './log.mjs'
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
const canOpenEditor = await ping().then(data => data.is_local_ip).catch(() => 0)
const logsStore = []
let logsVirtualList = null
/** @type {ReturnType<typeof attachLogWire> | null} */
let logsWireHandle = null
let logFilterText = ''
let logLevelFilter = 'all'

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
		const localVer = (await ping()).ver
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
 * 构建打开源码的回调。
 * @param {object} callsite - 调用位置信息。
 * @returns {Promise<void>}
 */
async function handleOpenSource(callsite) {
	const result = await openSource(callsite.filePath, callsite.line, callsite.column)
	if (!result.success)
		showToastI18n('error', 'debug_info.logs.openSourceFailed', { message: result.message || 'failed' })
}

/**
 * 获取经过过滤的日志切片。
 * @param {number} offset - 在过滤结果数组中的起始下标。
 * @param {number} limit - 最大返回条数；为 0 或省略时一直取到末尾。
 * @returns {{items: object[], total: number}} `items` 为当前页条目，`total` 为过滤后总数。
 */
function getFilteredSlice(offset, limit) {
	const filtered = logsStore.filter(e => entryMatchesFilter(e, logFilterText, logLevelFilter))
	return {
		items: filtered.slice(offset, limit ? offset + limit : undefined),
		total: filtered.length,
	}
}

/**
 * 初始化日志虚拟列表。
 * @returns {void}
 */
function initLogsVirtualList() {
	if (logsVirtualList) logsVirtualList.destroy()

	/**
	 * 虚拟列表分页回调：返回当前过滤条件下的切片。
	 * @param {number} offset - 起始下标。
	 * @param {number} limit - 最大条数。
	 * @returns {Promise<{items: object[], total: number}>} 过滤后的分页数据。
	 */
	const fetchLogSlice = async (offset, limit) => getFilteredSlice(offset, limit)

	/**
	 * 将单条后端日志渲染为列表行。
	 * @param {object} item - 日志条目载荷。
	 * @returns {HTMLElement} 该行对应的 DOM。
	 */
	const renderLogEntry = (item) => renderLogItem(item, {
		canOpenEditor,
		onOpenSource: handleOpenSource,
		/**
		 * 懒加载展开 truncated 节点时向服务端索取完整子树。
		 * @param {string} ref - 服务端分配的引用 ID。
		 * @returns {Promise<unknown>} 展开后的子树快照。
		 */
		requestExpandRef: (ref) => {
			if (!logsWireHandle)
				return Promise.reject(new Error('log WebSocket not ready'))
			return logsWireHandle.requestExpand(ref)
		},
	})

	const filtered = logsStore.filter(e => entryMatchesFilter(e, logFilterText, logLevelFilter))
	logsVirtualList = createVirtualList({
		container: backendLogList,
		fetchData: fetchLogSlice,
		renderItem: renderLogEntry,
		initialIndex: filtered.length ? filtered.length - 1 : 0,
	})
}

/**
 * 清空日志列表 UI（与下行 `vc_log_cleared` 或服务端 `clear()` 对齐）。
 * @returns {void}
 */
function clearLogsView() {
	logsStore.length = 0
	initLogsVirtualList()
}

/**
 * 建立后台日志 WS 连接。
 * @returns {void}
 */
function connectLogsWs() {
	if (logsWireHandle?.ws && (logsWireHandle.ws.readyState === WebSocket.OPEN || logsWireHandle.ws.readyState === WebSocket.CONNECTING)) return
	logsWireHandle?.detach()
	const ws = createLogsWs()
	logsWireHandle = attachLogWire(ws, {
		/**
		 * WebSocket 初始快照：用服务端完整缓冲替换本地列表。
		 * @param {object[]} entries - 日志条目数组。
		 * @returns {void}
		 */
		onSnapshot: (entries) => {
			logsStore.length = 0
			logsStore.push(.../** @type {any[]} */ entries)
			initLogsVirtualList()
		},
		/**
		 * 收到单条新日志：追加存储并按过滤条件更新虚拟列表。
		 * @param {object} entry - 新日志条目。
		 * @returns {Promise<void>}
		 */
		onAppend: async (entry) => {
			logsStore.push(/** @type {any} */ entry)
			if (entryMatchesFilter(entry, logFilterText, logLevelFilter)) {
				const nearBottom = Math.abs((backendLogList.scrollHeight - backendLogList.scrollTop) - backendLogList.clientHeight) < 64
				if (logsVirtualList)
					await logsVirtualList.appendItem(entry, nearBottom)
			}
		},
		/**
		 * 服务端通知清空：重置本地缓冲与 UI。
		 * @returns {void}
		 */
		onClear: () => clearLogsView(),
		/**
		 * 连接断开：短暂延迟后尝试重连。
		 * @returns {void}
		 */
		onClose: () => setTimeout(connectLogsWs, 1500),
	})
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

// 初始化日志工具栏
const logToolbarContainer = document.getElementById('log-toolbar-container')
if (logToolbarContainer) {
	const toolbar = createLogToolbar({
		container: backendLogList,
		/**
		 * 用户清空日志：优先通过 WS 同步服务端，否则仅清空前端视图。
		 * @returns {void}
		 */
		onClear: () => {
			if (logsWireHandle.requestClear()) return
			clearLogsView()
		},
		/**
		 * 关键字或级别过滤变更时重建虚拟列表。
		 * @param {string} text - 过滤关键字（空表示不过滤文本）。
		 * @param {string} level - `all` 或具体日志级别。
		 * @returns {void}
		 */
		onFilter: (text, level) => {
			logFilterText = text
			logLevelFilter = level
			initLogsVirtualList()
		},
	})
	logToolbarContainer.appendChild(toolbar)
}

if (!document.hidden) startPollTimer()

pollVersionInfo()
fetchSystemInfo()
checkFrontendConnectivity()
fetchAutoUpdateStatus()
connectLogsWs()
