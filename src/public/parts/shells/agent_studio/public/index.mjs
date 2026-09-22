/**
 * 【文件】public/index.mjs — agent_studio 页面入口
 * 【职责】应用主题、初始化 i18n、绑定导航、预载共享数据，并按 hash 进入首个视图。
 * 【原理】视图逻辑在 `src/views/*`，路由在 `src/navigation.mjs`；语言切换后重渲染当前视图。
 * 【关联】src/navigation.mjs、src/data.mjs、src/views/*、index.html。
 */
import { initTranslations, onLanguageChange } from '/scripts/i18n/index.mjs'
import { applyTheme } from '/scripts/theme/index.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'
import { createReadyGate } from '/scripts/test/ready_gate.mjs'

import { reloadBenchmarks, reloadChars, reloadRetention } from './src/data.mjs'
import { AGENT_STUDIO_GATE } from './src/gate.mjs'
import { applyIncomingNavigation, switchView } from './src/navigation.mjs'
import { currentMainView } from './src/viewChrome.mjs'
import { initBenchmarksView } from './src/views/benchmarks.mjs'
import { initDashboardView } from './src/views/dashboard.mjs'
import { initGenerationsView } from './src/views/generations.mjs'
import { initSettingsView } from './src/views/settings.mjs'

/**
 * 绑定侧栏 / 移动端底栏的视图按钮与全局刷新。
 * @returns {void}
 */
function wireNavigation() {
	for (const button of document.querySelectorAll('.nav-btn[data-view]'))
		button.addEventListener('click', () => { void switchView(button.dataset.view) })
	document.getElementById('globalRefreshButton')?.addEventListener('click', () => { void refreshAll() })
}

/**
 * 重新加载共享数据并重渲染当前视图。
 * @returns {Promise<void>}
 */
async function refreshAll() {
	const button = document.getElementById('globalRefreshButton')
	if (button instanceof HTMLButtonElement) button.disabled = true
	try {
		await Promise.all([reloadChars(), reloadBenchmarks(), reloadRetention()])
		await switchView(currentMainView() || 'dashboard', { skipHash: true })
	}
	catch (error) {
		showToastI18n('error', 'agent_studio.alerts.loadFailed', { message: error.message })
	}
	finally {
		if (button instanceof HTMLButtonElement) button.disabled = false
	}
}

/**
 * 页面初始化。
 * @returns {Promise<void>}
 */
async function boot() {
	const gate = createReadyGate(AGENT_STUDIO_GATE)
	gate.markPending()
	try {
		applyTheme()
		await initTranslations('agent_studio')
		wireNavigation()
		initDashboardView()
		initGenerationsView()
		initBenchmarksView()
		initSettingsView()
		onLanguageChange(() => {
			const view = currentMainView()
			if (view) void switchView(view, { skipHash: true })
		})
		await Promise.all([reloadChars(), reloadBenchmarks(), reloadRetention()])
			.catch(error => showToastI18n('error', 'agent_studio.alerts.loadFailed', { message: error.message }))
		if (!await applyIncomingNavigation())
			await switchView('dashboard', { skipHash: true })
		window.addEventListener('hashchange', () => { void applyIncomingNavigation() })
		gate.markReady()
	}
	catch (error) {
		gate.markFailed(error)
		throw error
	}
}

await boot()
