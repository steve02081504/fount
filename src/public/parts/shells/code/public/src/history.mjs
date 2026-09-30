/**
 * 输入历史数据层：加载 / 合并 / 补全候选 / 本地追加（普通消息与 shell 各自独立）。
 * 独立成模块以打断 composer 与 submission 的循环依赖；本模块不 import 任何业务模块。
 */
import * as api from './endpoints.mjs'
import { getPref, setPref, store, target } from './store.mjs'

/**
 * 合并历史条目（保持去重；已存在的本地追加优先，避免加载覆盖加载期间的本地新条目）。
 * @param {string[]} loaded - 后端读取的历史（追加序）。
 * @param {string[]} existing - 本地已有历史（追加序）。
 * @returns {string[]} 合并结果。
 */
function mergeHistoryEntries(loaded, existing) {
	const seen = new Set()
	const out = []
	for (const entry of [...loaded, ...existing]) {
		if (!entry || seen.has(entry)) continue
		seen.add(entry)
		out.push(entry)
	}
	return out
}

/**
 * 加载当前模式历史。
 * @param {'shell'|'message'} mode - 历史模式。
 * @returns {Promise<void>} 完成。
 */
async function loadHistory(mode) {
	if (mode === 'shell') {
		const data = await api.getHistory(target(), 'shell', store.shell).catch(() => ({ own: [], native: [] }))
		store.historyState.own = mergeHistoryEntries(data.own || [], store.historyState.own)
		store.historyState.native = data.native || []
	}
	else if (store.workspace) {
		const data = await api.getHistory(target(), 'message').catch(() => ({ own: [] }))
		store.historyState.own = mergeHistoryEntries(data.own || [], store.historyState.own)
		store.historyState.native = []
	}
	else {
		store.historyState.own = mergeHistoryEntries(JSON.parse(getPref('messageHistory') || '[]'), store.historyState.own)
		store.historyState.native = []
	}
	store.historyState.mode = mode
}

/**
 * 确保当前模式历史已加载。
 * @param {'shell'|'message'} mode - 历史模式。
 * @returns {Promise<void>} 完成。
 */
export async function ensureHistory(mode) {
	if (store.historyState.mode === mode) return
	await loadHistory(mode)
}

/**
 * 合并后的补全候选（自有优先、newest-first、去重）。
 * @returns {string[]} 候选列表。
 */
export function historySuggestions() {
	const seen = new Set()
	const merged = []
	for (const entry of [...store.historyState.own].reverse().concat(store.historyState.native)) {
		if (!entry || seen.has(entry)) continue
		seen.add(entry)
		merged.push(entry)
	}
	return merged
}

/**
 * 自有历史（newest-first，↑/↓ 遍历用）。
 * @returns {string[]} 历史列表。
 */
export function ownHistoryNewest() {
	return [...store.historyState.own].reverse()
}

/**
 * 追加一条自有历史并持久化（本地状态立即更新；无工作区时消息历史回退 localStorage）。
 * @param {'shell'|'message'} kind - 历史类型。
 * @param {string} command - 条目内容。
 * @returns {void}
 */
export function appendLocalHistory(kind, command) {
	if (!command?.trim()) return
	store.historyState.own = [...store.historyState.own.filter(entry => entry !== command), command]
	if (store.workspace)
		void api.appendHistory(target(), kind, command).catch(() => { })
	else {
		const list = JSON.parse(getPref('messageHistory') || '[]')
		setPref('messageHistory', JSON.stringify([...list.filter(entry => entry !== command), command].slice(-500)))
	}
}
