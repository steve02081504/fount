import { applyTheme } from '/scripts/theme.mjs'
import { showToastI18n } from '/scripts/toast.mjs'
import { initTranslations, i18nElement } from '/scripts/i18n.mjs'
import { renderTemplate, usingTemplates } from '/scripts/template.mjs'

applyTheme()
usingTemplates('/shells/debug_info/templates')
await initTranslations('debug_info')

const versionIndicator = document.getElementById('version-indicator'),
	localVersion = document.getElementById('local-version'),
	remoteVersion = document.getElementById('remote-version'),
	systemInfoTable = document.getElementById('system-info-table'),
	backendChecks = document.getElementById('backend-checks'),
	frontendChecks = document.getElementById('frontend-checks'),
	copyBtn = document.getElementById('copy-btn')

const debugData = {
	timestamp: new Date().toISOString(),
	version: {},
	system: {},
	connectivity: {
		backend: [],
		frontend: [],
	},
}

/**
 * 获取版本信息并更新 UI。
 */
async function fetchVersionInfo() {
	try {
		// Local Version
		const localRes = await fetch('/api/ping')
		const localData = await localRes.json()
		const localVer = localData.ver
		localVersion.textContent = localVer
		debugData.version.local = localVer

		// Remote Version
		const remoteRes = await fetch('https://api.github.com/repos/steve02081504/fount/commits/master', { cache: 'no-cache' })
		const remoteData = await remoteRes.json()
		const { sha: remoteVer } = remoteData
		remoteVersion.textContent = remoteVer
		debugData.version.remote = remoteVer

		// Compare
		if (localVer === remoteVer) {
			versionIndicator.className = 'badge badge-lg badge-success gap-2'
			versionIndicator.dataset.i18n = 'debug_info.versionStatus.upToDate'
		} else {
			versionIndicator.className = 'badge badge-lg badge-error gap-2'
			versionIndicator.dataset.i18n = 'debug_info.versionStatus.outdated'
		}
	} catch (error) {
		console.error('Version check failed:', error)
		versionIndicator.className = 'badge badge-lg badge-warning gap-2'
		versionIndicator.dataset.i18n = 'debug_info.versionStatus.checkFailed'
	}
	i18nElement(versionIndicator)
}

/**
 * 获取系统信息并更新 UI。
 */
async function fetchSystemInfo() {
	try {
		const res = await fetch('/api/shells/debug_info/system_info')
		const data = await res.json()
		debugData.system = data

		const { os, cpu, memory, connectivity } = data

		// Render System Info
		const rows = [
			{ key: 'OS', val: `${os.platform} ${os.release} (${os.arch})` },
			{ key: 'CPU', val: `${cpu.model} (${cpu.cores} cores) @ ${cpu.speed}MHz` },
			{ key: 'Memory', val: `Total: ${(memory.total / 1024 / 1024 / 1024).toFixed(2)} GB / Free: ${(memory.free / 1024 / 1024 / 1024).toFixed(2)} GB` },
		]

		systemInfoTable.innerHTML = ''
		systemInfoTable.appendChild(await renderTemplate('system_info_table', { rows }))

		// Render Backend Connectivity
		debugData.connectivity.backend = connectivity
		backendChecks.innerHTML = ''
		backendChecks.appendChild(await renderTemplate('connectivity_list', { checks: connectivity }))
	} catch (error) {
		console.error('System info fetch failed:', error)
		systemInfoTable.innerHTML = '<tr><td colspan="2" class="text-error text-center" data-i18n="debug_info.systemInfo.failed"></td></tr>'
		i18nElement(systemInfoTable)
	}
}

/**
 * 检查前端连接性并更新 UI。
 */
async function checkFrontendConnectivity() {
	const checks = [
		{ id: 'check-esm', name: 'esm.sh', url: 'https://esm.sh' },
		{ id: 'check-jsdelivr', name: 'jsDelivr', url: 'https://cdn.jsdelivr.net' },
		{ id: 'check-iconify', name: 'Iconify', url: 'https://api.iconify.design' },
		{ id: 'check-fount-public', name: 'fount Public', url: 'https://steve02081504.github.io/fount' }
	]

	frontendChecks.innerHTML = ''
	frontendChecks.appendChild(await renderTemplate('connectivity_list', { checks }))

	for (const check of checks) {
		const start = Date.now()
		let status = 'error'
		let duration = 0

		try {
			await fetch(check.url, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' }) // no-cors for opaque check
			status = 'ok'
			duration = Date.now() - start
		} catch (e) { status = 'error' }

		debugData.connectivity.frontend.push({ ...check, status, duration })

		document.getElementById(check.id).replaceWith(await renderTemplate('connectivity_item', { ...check, status, duration }))
	}
}

copyBtn.addEventListener('click', () => {
	const { timestamp, version, system, connectivity } = debugData
	const { os, cpu, memory } = system
	const report = `
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
Memory: Total ${(memory?.total / 1024 / 1024 / 1024).toFixed(2)} GB / Free ${(memory?.free / 1024 / 1024 / 1024).toFixed(2)} GB

Backend Connectivity
--------------------
${connectivity.backend.map(c => `${c.name}: ${c.status} (${c.duration || 0}ms)`).join('\n')}

Frontend Connectivity
---------------------
${connectivity.frontend.map(c => `${c.name}: ${c.status} (${c.duration || 0}ms)`).join('\n')}
`
	navigator.clipboard.writeText(report).then(() => {
		showToastI18n('success', 'debug_info.copySuccess')
	}).catch(() => {
		showToastI18n('error', 'debug_info.copyFailed')
	})
})

// Init
fetchVersionInfo()
fetchSystemInfo()
checkFrontendConnectivity()
