import { applyTheme } from '/scripts/theme/index.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'
import { initTranslations } from '/scripts/i18n/index.mjs'
import { onServerEvent } from '/scripts/endpoints/server_events.mjs'

import { ping } from '/scripts/endpoints/base.mjs'
import { createTestStatusWs, getSystemInfo, postRestart } from './src/endpoints.mjs'
import { recordLatency, redrawLatencySparklines } from './src/latency_sparkline.mjs'
import { mountTemplate, renderTemplate } from './templates.mjs'

applyTheme()
await initTranslations('debug_info')

const versionIndicator = document.getElementById('version-indicator'),
	localVersion = document.getElementById('local-version'),
	remoteVersion = document.getElementById('remote-version'),
	systemInfoTable = document.getElementById('system-info-table'),
	backendChecks = document.getElementById('backend-checks'),
	frontendChecks = document.getElementById('frontend-checks'),
	testStatusCard = document.getElementById('test-status-card'),
	testStatusToggle = document.getElementById('test-status-toggle'),
	testStatusBadge = document.getElementById('test-status-badge'),
	testStatusList = document.getElementById('test-status-list'),
	testStatusChevron = document.getElementById('test-status-chevron'),
	copyButton = document.getElementById('copy-button'),
	updateButton = document.getElementById('update-button'),
	updateButtonIcon = document.getElementById('update-button-icon'),
	updateButtonLabel = document.getElementById('update-button-label')

const debugData = {
	timestamp: new Date().toISOString(),
	version: {},
	system: {},
	connectivity: { backend: [], frontend: [] },
}

let isUpToDate = null

/**
 * 将字节数转换为 GiB。
 * @param {number} bytes - 字节数。
 * @returns {string} 以 GiB 为单位保留两位小数的字符串。
 */
const bytesToGiB = bytes => Number.isFinite(bytes) && bytes >= 0 ? (bytes / 1024 ** 3).toFixed(2) : 'Unknown'

/**
 * 根据系统报告的总量计算内存使用。
 * @param {{total?: number, free?: number}} memory 内存总量与可用量。
 * @returns {{used: number|null, percent: number|null}} 使用量与百分比。
 */
function getMemoryStats(memory = {}) {
	const total = Number(memory.total)
	const free = Number(memory.free)
	if (!Number.isFinite(total) || !Number.isFinite(free) || total <= 0) return { used: null, percent: null }
	const used = Math.max(0, total - Math.min(free, total))
	return { used, percent: Math.round(used / total * 100) }
}

/**
 * 更新状态徽标的语义样式。
 * @param {HTMLElement} element 徽标元素。
 * @param {string} state 状态名。
 */
function setBadgeState(element, state) {
	element.dataset.state = state
}

const FOUNT_REPO_COMPARE = 'https://api.github.com/repos/steve02081504/fount/compare'
const ICONIFY_LINE = 'https://api.iconify.design/line-md'
const SERVICE_ICONS = new Map([
	['npm Registry', 'square'],
	['Deno Land', 'engine'],
	['jsDelivr', 'cloud'],
	['JSR', 'list-3-filled'],
	['fount Network', 'link'],
	['fount Server', 'computer'],
	['esm.sh', 'cloud-alt-braces'],
	['Iconify', 'image'],
	['fount Public', 'external-link'],
])
/**
 * 获取服务图标地址。
 * @param {string} name 服务名。
 * @returns {string} 图标 URL。
 */
const serviceIcon = name => `${ICONIFY_LINE}/${SERVICE_ICONS.get(name) || 'square'}.svg`

/**
 * 比较 GitHub 分支与本地提交。
 * @param {string} branch 远端分支名。
 * @param {string} localSha 本地提交 SHA。
 * @returns {Promise<{status: string, ahead_by: number, behind_by: number}|null>} 比较结果，失败时返回 null。
 */
async function compareRemoteVersion(branch, localSha) {
	const res = await fetch(`${FOUNT_REPO_COMPARE}/${encodeURIComponent(branch)}...${encodeURIComponent(localSha)}`, { cache: 'no-cache' })
	if (!res.ok) return null
	const result = await res.json()
	if (!['ahead', 'behind', 'diverged', 'identical'].includes(result.status)
		|| !Number.isFinite(result.ahead_by) || !Number.isFinite(result.behind_by)
		|| typeof result.base_commit?.sha !== 'string') return null
	return result
}

/**
 * 获取版本信息并更新 UI。
 */
async function fetchVersionInfo() {
	try {
		const { ver: localVer, branch: currentBranch } = await ping()
		localVersion.textContent = localVer
		debugData.version.local = localVer

		const compareBranch = currentBranch || 'master'
		debugData.version.branch = compareBranch
		const comparison = await compareRemoteVersion(compareBranch, localVer)
		if (!comparison) throw new Error('remote version comparison unavailable')
		remoteVersion.textContent = comparison.base_commit.sha
		debugData.version.remote = remoteVersion.textContent
		debugData.version.comparison = comparison

		// GitHub's status describes remote base...local head. Only remote commits
		// missing locally mean an update is available; local-only commits do not.
		isUpToDate = comparison.behind_by === 0
		setBadgeState(versionIndicator, isUpToDate ? 'ok' : 'outdated')
		versionIndicator.dataset.i18n = isUpToDate ? 'debug_info.versionStatus.upToDate' : 'debug_info.versionStatus.outdated'
	} catch (error) {
		console.warn('Version check failed:', error)
		setBadgeState(versionIndicator, 'failed')
		versionIndicator.dataset.i18n = 'debug_info.versionStatus.checkFailed'
		isUpToDate = null
	}
	refreshUpdateButton()
}

onServerEvent('server-updated', () => { fetchVersionInfo(); pollConnectivity() })
onServerEvent('server-reconnected', () => { fetchVersionInfo(); pollConnectivity() })

/**
 * 获取系统信息并更新 UI。
 */
async function fetchSystemInfo() {
	try {
		const data = await getSystemInfo()
		debugData.system = data

		const { os = {}, cpu = {}, memory = {}, connectivity = [] } = data
		const { percent } = getMemoryStats(memory)
		document.getElementById('memory-percent').textContent = percent == null ? '--%' : `${percent}%`
		document.getElementById('memory-progress').value = percent ?? 0
		const rows = [
			{ key: 'OS', icon: `${ICONIFY_LINE}/monitor.svg`, val: `${os.platform} ${os.release} (${os.arch})` },
			{ key: 'CPU', icon: `${ICONIFY_LINE}/cog.svg`, val: `${cpu.model} (${cpu.cores} cores) @ ${cpu.speed}MHz` },
			{ key: 'Memory', icon: `${ICONIFY_LINE}/engine.svg`, val: `Total: ${bytesToGiB(memory.total)} GB / Free: ${bytesToGiB(memory.free)} GB` },
		]

		await mountTemplate(systemInfoTable, 'system_info_table', { rows })

		debugData.connectivity.backend = connectivity
		for (const check of connectivity) recordLatency(check.id || check.name, check.duration)
		await mountTemplate(backendChecks, 'connectivity_list', {
			checks: connectivity.map(check => ({ ...check, icon: serviceIcon(check.name) })),
		})
		redrawLatencySparklines(backendChecks)
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
		{ id: 'check-fount-server', name: 'fount Server', icon: serviceIcon('fount Server'), url: '/api/ping' },
		{ id: 'check-esm', name: 'esm.sh', icon: serviceIcon('esm.sh'), url: 'https://esm.sh' },
		{ id: 'check-jsdelivr', name: 'jsDelivr', icon: serviceIcon('jsDelivr'), url: 'https://cdn.jsdelivr.net' },
		{ id: 'check-iconify', name: 'Iconify', icon: serviceIcon('Iconify'), url: 'https://api.iconify.design' },
		{ id: 'check-fount-public', name: 'fount Public', icon: serviceIcon('fount Public'), url: 'https://steve02081504.github.io/fount' }
	]

	if (!frontendChecks.querySelector('[data-connectivity-key]'))
		await mountTemplate(frontendChecks, 'connectivity_list', { checks })
	const results = await Promise.all(checks.map(async check => {
		const start = Date.now()
		let status = 'error', duration
		try {
			const response = await fetch(check.url, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' })
			status = response.type === 'opaque' || response.ok ? 'ok' : 'error'
			duration = Date.now() - start
		} catch { /* unreachable */ }
		const result = { ...check, status, duration }
		recordLatency(check.id || check.name, duration)
		document.getElementById(check.id).replaceWith(await renderTemplate('connectivity_item', result))
		return result
	}))
	debugData.connectivity.frontend = results
	redrawLatencySparklines(frontendChecks)
}

let testStatusOpen = false
/** @type {Map<string, number>} 运行中套件 key → 开始时间戳。 */
const runningSuites = new Map()
/** @type {Set<string>} 排队套件 key。 */
const queuedSuites = new Set()
/** @type {boolean} 内核是否在线（随 snapshot 更新）。 */
let testStatusOnline = false
/** @type {boolean} 是否已调度一次合并且重的渲染。 */
let testStatusRenderQueued = false
/** @type {Promise<void>} 串行化渲染链，避免旧快照覆盖新状态。 */
let testStatusRenderChain = Promise.resolve()
/** @type {WebSocket | null} */
let testStatusWs = null
/** @type {number | null} */
let testStatusReconnectTimer = null
let testStatusAttempt = 0

/**
 * 展开/收起测试状态列表。
 */
testStatusToggle.addEventListener('click', () => {
	testStatusOpen = !testStatusOpen
	testStatusList.classList.toggle('hidden', !testStatusOpen)
	testStatusToggle.setAttribute('aria-expanded', String(testStatusOpen))
	testStatusChevron?.classList.toggle('rotate-180', testStatusOpen)
	if (testStatusOpen) scheduleTestStatusRender()
})

/**
 * 渲染 fount test 内核状态卡片。
 * @param {object | null} status 状态；内核离线为 null。
 */
async function renderTestStatus(status) {
	const online = status?.online === true
	testStatusCard.classList.toggle('hidden', !online)
	if (!online) return
	setBadgeState(testStatusBadge, status.active ? 'running' : 'idle')
	testStatusBadge.dataset.i18n = status.active ? 'debug_info.testStatus.running' : 'debug_info.testStatus.idle'
	if (!status.active) {
		testStatusList.replaceChildren()
		return
	}
	if (!testStatusOpen) return
	const items = [
		...status.runningSuites.map(({ key, elapsedMs }) => ({
			key,
			state: 'running',
			sec: Math.max(1, Math.floor(elapsedMs / 1000)),
		})),
		...status.queuedSuites.map(key => ({ key, state: 'queued' })),
	]
	await mountTemplate(testStatusList, 'test_status_list', { items })
}

/**
 * 由本地运行的套件状态构建快照。
 * @returns {object} 与 `/status` 形状一致的状态对象。
 */
function buildTestStatus() {
	const active = runningSuites.size > 0 || queuedSuites.size > 0
	return {
		online: testStatusOnline,
		active,
		idle: !active,
		runningSuites: [...runningSuites].map(([key, startMs]) => ({ key, elapsedMs: Date.now() - startMs })),
		queuedSuites: [...queuedSuites],
	}
}

/**
 * 调度一次合并且串行的测试状态渲染：同一轮微任务内的多次状态变更合并为一次，
 * 渲染沿 promise 链串行执行，保证后置状态不被更早的异步挂载完成所覆盖。
 * @returns {void}
 */
function scheduleTestStatusRender() {
	if (testStatusRenderQueued) return
	testStatusRenderQueued = true
	queueMicrotask(() => {
		testStatusRenderQueued = false
		const status = buildTestStatus()
		testStatusRenderChain = testStatusRenderChain.then(() => renderTestStatus(status)).catch(() => { })
	})
}

/**
 * 应用一条 WS 消息（初始快照或内核实时事件）更新套件状态并重绘。
 * @param {object} message 消息
 * @returns {void}
 */
function applyTestStatusMessage(message) {
	switch (message.type) {
		case 'snapshot': {
			if (message.online === true) testStatusAttempt = 0
			testStatusOnline = message.online === true
			runningSuites.clear()
			queuedSuites.clear()
			for (const { key, elapsedMs } of message.runningSuites || [])
				runningSuites.set(key, Date.now() - elapsedMs)
			for (const key of message.queuedSuites || []) queuedSuites.add(key)
			scheduleTestStatusRender()
			break
		}
		case 'queue-append':
			queuedSuites.add(message.key)
			scheduleTestStatusRender()
			break
		case 'queue-remove':
			queuedSuites.delete(message.key)
			scheduleTestStatusRender()
			break
		case 'suite-start':
			queuedSuites.delete(message.key)
			runningSuites.set(message.key, Date.now())
			scheduleTestStatusRender()
			break
		case 'suite-end':
			runningSuites.delete(message.key)
			scheduleTestStatusRender()
			break
		case 'idle':
			runningSuites.clear()
			queuedSuites.clear()
			scheduleTestStatusRender()
			break
		default:
			break
	}
}

/**
 * 建立测试状态 WebSocket（仅页面可见时）。
 * @returns {void}
 */
function connectTestStatusWs() {
	if (testStatusWs) return
	const ws = createTestStatusWs()
	testStatusWs = ws
	ws.addEventListener('message', (event) => {
		let message
		try { message = JSON.parse(String(event.data)) } catch { return }
		applyTestStatusMessage(message)
	})
	ws.addEventListener('close', () => {
		if (testStatusWs !== ws) return
		testStatusWs = null
		testStatusOnline = false
		runningSuites.clear()
		queuedSuites.clear()
		scheduleTestStatusRender()
		scheduleTestStatusReconnect()
	})
	ws.addEventListener('error', () => { if (testStatusWs === ws) ws.close() })
}

/**
 * 调度重连（指数退避，仅页面可见时）。
 * @returns {void}
 */
function scheduleTestStatusReconnect() {
	if (document.hidden) return
	const delay = Math.min(1500 * 2 ** testStatusAttempt++, 10000)
	testStatusReconnectTimer = setTimeout(() => {
		testStatusReconnectTimer = null
		connectTestStatusWs()
	}, delay)
}

/**
 * 启动测试状态流（若未在跑）。
 * @returns {void}
 */
function startTestStatusStream() {
	if (testStatusWs || testStatusReconnectTimer) return
	connectTestStatusWs()
}

/**
 * 停止测试状态流（页面隐藏时）。
 * @returns {void}
 */
function stopTestStatusStream() {
	clearTimeout(testStatusReconnectTimer)
	testStatusReconnectTimer = null
	testStatusWs?.close()
	testStatusWs = null
}

const UPDATE_ICON = 'https://api.iconify.design/line-md/backup-restore.svg'
const LOADING_ICON = 'https://api.iconify.design/line-md/loading-loop.svg'
const UPTODATE_ICON = 'https://api.iconify.design/line-md/confirm.svg'

/**
 * 根据当前版本状态刷新更新按钮的样式与可用性（有更新时才可点击，是否允许更新交给后端判定）。
 */
function refreshUpdateButton() {
	const upToDate = isUpToDate === true
	updateButton.disabled = isUpToDate !== false
	if (updateButtonIcon) {
		updateButtonIcon.crossOrigin = 'anonymous'
		updateButtonIcon.src = upToDate ? UPTODATE_ICON : UPDATE_ICON
	}
	if (updateButtonLabel) updateButtonLabel.dataset.i18n = upToDate ? 'debug_info.alreadyLatest' : 'debug_info.update.now'
}

/**
 * 将更新按钮切换为"重启中"状态（禁用并显示加载图标）。
 */
function setUpdateButtonRestarting() {
	updateButton.disabled = true
	if (updateButtonIcon) {
		updateButtonIcon.crossOrigin = 'anonymous'
		updateButtonIcon.src = LOADING_ICON
	}
	if (updateButtonLabel) updateButtonLabel.dataset.i18n = 'debug_info.update.restarting'
}

copyButton.addEventListener('click', () => {
	debugData.timestamp = new Date().toISOString()
	const { timestamp, version, system, connectivity } = debugData
	const { os, cpu, memory } = system
	const report = `\
fount Debug Report
==================
Timestamp: ${timestamp}

Version Status
--------------
Branch: ${version.branch || 'master'}
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

updateButton.addEventListener('click', async () => {
	updateButton.disabled = true
	try {
		const { ok, data } = await postRestart()
		if (ok) {
			setUpdateButtonRestarting()
			showToastI18n('success', 'debug_info.update.success')
		} else if (data.error === 'auto_update_disabled') {
			showToastI18n('warning', 'debug_info.autoUpdateNotEnabled')
			refreshUpdateButton()
		} else {
			showToastI18n('error', 'debug_info.update.failed')
			refreshUpdateButton()
		}
	} catch {
		showToastI18n('error', 'debug_info.update.failed')
		refreshUpdateButton()
	}
})

const VERSION_POLL_INTERVAL = 5 * 60 * 1000
let lastVersionCheckTime = 0
let pollTimer = null
const CONNECTIVITY_POLL_INTERVAL = 10_000
const connectivityTimers = new Map()
const connectivityRequests = new Map()

/**
 * 独立采样前后端连通性，并避免慢探测累积重复请求。
 * @param {() => Promise<void>} probe 连通性探测。
 * @returns {Promise<void>} 本次探测。
 */
function runConnectivityProbe(probe) {
	if (connectivityRequests.has(probe)) return connectivityRequests.get(probe)
	const request = probe().finally(() => {
		connectivityRequests.delete(probe)
		if (!document.hidden && !connectivityTimers.has(probe))
			connectivityTimers.set(probe, setTimeout(() => {
				connectivityTimers.delete(probe)
				runConnectivityProbe(probe)
			}, CONNECTIVITY_POLL_INTERVAL))
	})
	connectivityRequests.set(probe, request)
	return request
}

/**
 * 刷新前后端连通性，各自独立安排下一次采样。
 * @returns {Promise<void[]>} 本次探测。
 */
function pollConnectivity() {
	return Promise.all([fetchSystemInfo, checkFrontendConnectivity].map(runConnectivityProbe))
}

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
	if (document.hidden) {
		stopPollTimer()
		for (const timer of connectivityTimers.values()) clearTimeout(timer)
		connectivityTimers.clear()
		stopTestStatusStream()
	}
	else {
		if (Date.now() - lastVersionCheckTime >= VERSION_POLL_INTERVAL) pollVersionInfo()
		pollConnectivity()
		startPollTimer()
		startTestStatusStream()
	}
})

if (!document.hidden) startPollTimer()

let redrawFrame = null
/** 将布局触发的画布重绘合并到同一帧。 */
const redrawSparklines = () => {
	if (redrawFrame != null) return
	redrawFrame = requestAnimationFrame(() => {
		redrawFrame = null
		redrawLatencySparklines()
	})
}
new ResizeObserver(redrawSparklines).observe(document.documentElement)
new MutationObserver(redrawSparklines).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

if (!document.hidden) {
	pollVersionInfo()
	pollConnectivity()
	startTestStatusStream()
}
