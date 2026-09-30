/**
 * 按标签页的会话落盘队列：修订号跟踪、串行写入、失败保留可重试状态、失焦/卸载前统一 flush。
 */
import { showToastI18n } from '/scripts/features/toast.mjs'

import * as api from './endpoints.mjs'
import { getRuntime, isGenerating, store, tabKeyOf, tabKeyOfSession } from './store.mjs'

/** 供上层注册的钩子（避免向下依赖 tabs / session 业务模块）。 */
const hooks = { onTabPromoted: null }

/**
 * 注册落盘相关钩子。
 * @param {{onTabPromoted?: (tabKey: string) => void}} next - 钩子。
 * @returns {void}
 */
export function registerPersistenceHooks(next) {
	Object.assign(hooks, next)
}

/** 每个标签键的串行写入链。 @type {Map<string, Promise<void>>} */
const flushQueues = new Map()

/**
 * 标记会话为待持久化：记录修订并（非生成中时）立即排入落盘队列。
 * 草稿一旦可落盘即转为会话标签（防关闭丢失）。无工作区时会话无处落盘，跳过。
 * @param {object} [session] - 目标会话（默认当前展示会话；后台生成时传入）。
 * @returns {Promise<void>|undefined} 已触发落盘时返回其 promise。
 */
export function markSessionDirty(session = store.session) {
	const tabKey = tabKeyOfSession(session)
	if (!tabKey) return
	const runtime = getRuntime(tabKey, { create: true })
	const tab = store.tabs.find(item => tabKeyOf(item) === tabKey)
	if (!tab) return
	const workspace = store.workspaces.find(w => w.id === tab.workspaceId)
	if (!workspace) return
	runtime.session = session
	// 捕获落盘目标（工作区可能在 flush 前被移除）
	runtime.flushTarget = { machine: String(workspace.machine ?? store.machine), workdir: workspace.path }
	runtime.revision++
	if (tab.type === 'draft') {
		tab.type = 'session'
		hooks.onTabPromoted?.(tabKey)
	}
	// 生成中只有本标签页暂停 flush（后端是权威写者），其他标签页不受影响
	if (isGenerating(tabKey) || runtime.status === 'recovering') return
	return flushSession(tabKey)
}

/**
 * 将某标签页的会话串行写入其工作区（生成中、无变更、无工作区时跳过）。
 * @param {string} [tabKey] - 标签键；缺省为活动标签页。
 * @returns {Promise<void>} 写入完成。
 */
export function flushSession(tabKey = store.activeTabKey) {
	if (!tabKey) return Promise.resolve()
	const previous = flushQueues.get(tabKey) || Promise.resolve()
	const next = previous.catch(() => { }).then(() => writeSession(tabKey))
	flushQueues.set(tabKey, next)
	return next
}

/**
 * 实际执行一次落盘（修订号一致时跳过）。
 * @param {string} tabKey - 标签键。
 * @returns {Promise<void>} 完成。
 */
async function writeSession(tabKey) {
	const runtime = getRuntime(tabKey)
	if (!runtime) return
	if (isGenerating(tabKey) || runtime.status === 'recovering') return
	if (runtime.revision === runtime.savedRevision) return
	const tab = store.tabs.find(item => tabKeyOf(item) === tabKey)
	const workspace = tab && store.workspaces.find(w => w.id === tab.workspaceId)
	const flushTarget = runtime.flushTarget || (workspace ? { machine: String(workspace.machine ?? store.machine), workdir: workspace.path } : null)
	if (!flushTarget) return
	const session = runtime.session || (tabKey === store.activeTabKey ? store.session : null)
	if (!session || !(session.entries?.length || 0)) return
	const revision = runtime.revision
	try {
		await api.putSession(flushTarget, session)
		runtime.savedRevision = revision
		runtime.flushError = false
	}
	catch (error) {
		runtime.flushError = true
		showToastI18n('error', 'code.error.generic', { error: String(error.message || error) })
	}
}

/**
 * 落盘全部脏标签（各自串行；生成中的标签自动跳过）。
 * @returns {Promise<unknown[]>} 全部完成。
 */
export function flushAllDirty() {
	return Promise.all([...store.runtimes.keys()].map(tabKey => flushSession(tabKey)))
}

/** 卸载前同步尽力写入（fetch 不被取消的窗口内发出请求）。 */
function flushBeforeUnload() {
	for (const [tabKey, runtime] of store.runtimes) {
		if (isGenerating(tabKey) || runtime.status === 'recovering') continue
		if (runtime.revision === runtime.savedRevision) continue
		const tab = store.tabs.find(item => tabKeyOf(item) === tabKey)
		const workspace = tab && store.workspaces.find(w => w.id === tab.workspaceId)
		const flushTarget = runtime.flushTarget || (workspace ? { machine: String(workspace.machine ?? store.machine), workdir: workspace.path } : null)
		const session = runtime.session || (tabKey === store.activeTabKey ? store.session : null)
		if (!flushTarget || !session || !(session.entries?.length || 0)) continue
		api.putSession(flushTarget, session).catch(() => { })
	}
}

window.addEventListener('blur', () => { void flushAllDirty() })
document.addEventListener('visibilitychange', () => {
	if (document.hidden) void flushAllDirty()
})
window.addEventListener('beforeunload', flushBeforeUnload)
