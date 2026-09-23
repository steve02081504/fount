/**
 * 【文件】public/src/navigation.mjs — 主视图路由
 * 【职责】按视图名切换页面区块并加载数据；同步 location.hash 与浏览器 hashchange。
 * 【原理】视图懒加载器映射；`#conversation/subagent%3A<runId>` 与普通会话共用会话视图；切换时用 View Transition 做过渡；加载失败经 handleError 提示。
 * 【关联】viewChrome.mjs、views/*、motion/viewTransition.mjs。
 */
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { viewTransition } from '/scripts/motion/viewTransition.mjs'

import { NAVIGATE_EVENT } from './lib/navigationEvents.mjs'
import { activateView, currentMainView, MAIN_NAV_VIEWS } from './viewChrome.mjs'
import { loadBenchmarks } from './views/benchmarks.mjs'
import { loadConversationView } from './views/conversation.mjs'
import { loadDashboard } from './views/dashboard.mjs'
import { loadGenerations } from './views/generations.mjs'
import { loadSettings } from './views/settings.mjs'

/** 全部可进入的视图（主导航 + 会话深链）。 */
const ALL_VIEWS = [...MAIN_NAV_VIEWS, 'conversation']

/** 视图名 → 数据加载器。 */
const VIEW_LOADERS = {
	dashboard: loadDashboard,
	generations: loadGenerations,
	benchmarks: loadBenchmarks,
	settings: loadSettings,
	conversation: loadConversationView,
}

/** 当前深链参数（会话键等）。 */
let currentParams = {}

/**
 * 监听视图派发的导航请求（如子代理视图的返回按钮）。
 * @returns {void}
 */
export function installNavigationEvents() {
	window.addEventListener(NAVIGATE_EVENT, event => {
		const view = event.detail?.view
		if (typeof view === 'string') void switchView(view, { params: event.detail?.params })
	})
}

/**
 * 把主视图同步到 location.hash（replace，避免历史堆叠）。
 * @param {string} view 视图名
 * @param {object} [params] 视图参数
 * @returns {void}
 */
function syncHashForMainView(view, params = {}) {
	let next = `#${view}`
	if (view === 'conversation' && params.key) next = `#conversation/${encodeURIComponent(params.key)}`
	if (location.hash === next) return
	history.replaceState(null, '', `${location.pathname}${location.search}${next}`)
}

/**
 * 切换主视图并加载数据。
 * @param {string} view 视图名；非法值回退 dashboard
 * @param {{ skipHash?: boolean, params?: object }} [options] skipHash 为 true 时不写 URL
 * @returns {Promise<void>}
 */
export async function switchView(view, options = {}) {
	const target = ALL_VIEWS.includes(view) ? view : 'dashboard'
	const from = currentMainView()
	if (from && from !== target)
		await viewTransition(() => renderSwitchView(target, options))
	else
		await renderSwitchView(target, options)
}

/**
 * 实际执行视图切换与数据加载（在可能的 View Transition 回调内运行）。
 * @param {string} view 视图名
 * @param {{ skipHash?: boolean, params?: object }} options 切换选项
 * @returns {Promise<void>}
 */
async function renderSwitchView(view, options) {
	currentParams = options.params ?? {}
	activateView(view)
	if (!options.skipHash)
		syncHashForMainView(view, currentParams)
	try {
		await VIEW_LOADERS[view](currentParams)
	}
	catch (error) {
		handleError('agent_studio.alerts.loadFailed', { message: error.message }, error)
	}
}

/**
 * 解析 URL hash 并导航（支持 `#subagent/<runId>` 深链）。
 * @returns {Promise<boolean>} 是否已处理导航
 */
export async function applyIncomingNavigation() {
	const rawHash = window.location.hash.replace(/^#/, '')
	const subagentMatch = /^subagent\/(.+)$/.exec(rawHash)
	if (subagentMatch) {
		const runId = decodeURIComponent(subagentMatch[1])
		await switchView('conversation', { params: { key: 'subagent:' + runId } })
		return true
	}
	const conversationMatch = /^conversation\/(.+)$/.exec(rawHash)
	if (conversationMatch) {
		const key = decodeURIComponent(conversationMatch[1])
		if (currentMainView() === 'conversation' && currentParams.key === key) return true
		await switchView('conversation', { skipHash: true, params: { key } })
		return true
	}
	if (!MAIN_NAV_VIEWS.includes(rawHash)) return false
	if (currentMainView() === rawHash) return true
	await switchView(rawHash, { skipHash: true })
	return true
}
