/**
 * 【文件】public/src/navigation.mjs — 主视图路由
 * 【职责】按视图名切换页面区块并加载数据；同步 location.hash 与浏览器 hashchange。
 * 【原理】视图懒加载器映射；切换时用 View Transition 做过渡；加载失败经 handleError 提示。
 * 【关联】viewChrome.mjs、views/*、motion/viewTransition.mjs。
 */
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { viewTransition } from '/scripts/motion/viewTransition.mjs'

import { activateView, currentMainView, MAIN_NAV_VIEWS } from './viewChrome.mjs'
import { loadBenchmarks } from './views/benchmarks.mjs'
import { loadDashboard } from './views/dashboard.mjs'
import { loadGenerations } from './views/generations.mjs'
import { loadSettings } from './views/settings.mjs'

/** 视图名 → 数据加载器。 */
const VIEW_LOADERS = {
	dashboard: loadDashboard,
	generations: loadGenerations,
	benchmarks: loadBenchmarks,
	settings: loadSettings,
}

/**
 * 把主视图同步到 location.hash（replace，避免历史堆叠）。
 * @param {string} view 视图名
 * @returns {void}
 */
function syncHashForMainView(view) {
	const next = `#${view}`
	if (location.hash === next) return
	history.replaceState(null, '', `${location.pathname}${location.search}${next}`)
}

/**
 * 切换主视图并加载数据。
 * @param {string} view 视图名；非法值回退 dashboard
 * @param {{ skipHash?: boolean }} [options] skipHash 为 true 时不写 URL
 * @returns {Promise<void>}
 */
export async function switchView(view, options = {}) {
	const target = MAIN_NAV_VIEWS.includes(view) ? view : 'dashboard'
	const from = currentMainView()
	if (from && from !== target)
		await viewTransition(() => renderSwitchView(target, options))
	else
		await renderSwitchView(target, options)
}

/**
 * 实际执行视图切换与数据加载（在可能的 View Transition 回调内运行）。
 * @param {string} view 视图名
 * @param {{ skipHash?: boolean }} options 切换选项
 * @returns {Promise<void>}
 */
async function renderSwitchView(view, options) {
	activateView(view)
	if (!options.skipHash)
		syncHashForMainView(view)
	try {
		await VIEW_LOADERS[view]()
	}
	catch (error) {
		handleError('agent_studio.alerts.loadFailed', { message: error.message }, error)
	}
}

/**
 * 解析 URL hash 并导航。
 * @returns {Promise<boolean>} 是否已处理导航
 */
export async function applyIncomingNavigation() {
	const rawHash = window.location.hash.replace(/^#/, '')
	if (!MAIN_NAV_VIEWS.includes(rawHash)) return false
	if (currentMainView() === rawHash) return true
	await switchView(rawHash, { skipHash: true })
	return true
}
