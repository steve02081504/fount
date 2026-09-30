/**
 * 完成语义：运行终态的完成音、未读角标与已读标记。WS 终态帧与 `code-run-settled` 事件共用，按 runId 幂等。
 */
import { playNotificationSound } from '/scripts/features/notificationSound.mjs'

import { store, tabKeyOf } from './store.mjs'
import { renderTabs } from './tabs.mjs'

/** 声音去重集合的 localStorage 键（跨页面尽力去重）。 */
const SOUND_STORE_KEY = 'code.settledSoundIds'
/** 去重集合上限（超出丢弃最旧）。 */
const SOUND_STORE_MAX = 200
/** 本页已处理的终态运行 id。 */
const settledRuns = new Set()

/**
 * 读取已播放声音的运行 id 集合。
 * @returns {string[]} 运行 id 列表。
 */
function readSoundIds() {
	try {
		const raw = localStorage.getItem(SOUND_STORE_KEY)
		const list = raw ? JSON.parse(raw) : []
		return Array.isArray(list) ? list : []
	}
	catch {
		return []
	}
}

/**
 * 写入已播放声音的运行 id 集合（带上限裁剪）。
 * @param {string[]} ids - 运行 id 列表。
 * @returns {void}
 */
function writeSoundIds(ids) {
	try {
		localStorage.setItem(SOUND_STORE_KEY, JSON.stringify(ids.slice(-SOUND_STORE_MAX)))
	}
	catch { /* 隐私模式等写入失败：仅本页去重 */ }
}

/**
 * 领取一次某运行 id 的播放权（跨页面尽力互斥）。
 * @param {string} runId - 运行 id。
 * @returns {Promise<boolean>} 是否由本页播放。
 */
async function claimSound(runId) {
	if (settledRuns.has(runId)) return false
	settledRuns.add(runId)
	/**
	 * 在锁内判定并登记该运行 id（已登记过则返回 false）。
	 * @returns {boolean} 是否由本次调用领取。
	 */
	const claim = () => {
		const ids = readSoundIds()
		if (ids.includes(runId)) return false
		ids.push(runId)
		writeSoundIds(ids)
		return true
	}
	if (navigator.locks?.request)
		try {
			return await navigator.locks.request('code-settled-sound', claim)
		}
		catch { return claim() }
	return claim()
}

/**
 * 找到某会话对应的已打开标签。
 * @param {string} sessionId - 会话 id。
 * @param {string} [workspaceId] - 工作区 id（用于消歧）。
 * @returns {object|null} 标签页。
 */
function tabForSession(sessionId, workspaceId) {
	return store.tabs.find(tab => tab.type === 'session' && tab.id === sessionId && (!workspaceId || tab.workspaceId === workspaceId)) || null
}

/**
 * 标记某会话标签的未读角标（活动且可见聚焦时清除）。
 * @param {string} sessionId - 会话 id。
 * @param {string} [workspaceId] - 工作区 id。
 * @returns {void}
 */
export function markSessionUnread(sessionId, workspaceId) {
	if (!sessionId) return
	const tab = tabForSession(sessionId, workspaceId)
	if (!tab) return
	const tabKey = tabKeyOf(tab)
	const focusedActive = tabKey === store.activeTabKey && !document.hidden && document.hasFocus()
	if (focusedActive) store.tabUnread.delete(tabKey)
	else store.tabUnread.add(tabKey)
	renderTabs()
}

/**
 * 处理运行终态（WS 帧与 `code-run-settled` 事件共用，按 runId 幂等）。
 * 声音无条件播放一次；未读点仅在终态标签页非「可见且聚焦的活动标签页」时添加。
 * @param {{sessionId?: string, workspaceId?: string, runId?: string, status?: string}} payload - 终态负载。
 * @returns {Promise<void>} 完成。
 */
export async function handleRunSettled(payload = {}) {
	const { sessionId, workspaceId, runId } = payload
	if (!sessionId) return
	markSessionUnread(sessionId, workspaceId)
	if (!runId) return
	if (!await claimSound(runId)) return
	try {
		await playNotificationSound()
	}
	catch { /* 无音频权限 / 上下文受限：忽略 */ }
}

/**
 * 兼容入口：把旧的通知载荷（`tag: code:<sessionId>`）转调终态处理。
 * 无 runId 时只处理未读角标，不重复播放声音（声音由 `code-run-settled` 负责）。
 * @param {object} payload - 通知载荷。
 * @returns {Promise<void>} 完成。
 */
export async function bumpCodeSessionNotification(payload) {
	const tag = payload?.options?.tag || payload?.tag
	if (typeof tag !== 'string' || !tag.startsWith('code:')) return
	const sessionId = tag.slice('code:'.length)
	if (!sessionId) return
	await handleRunSettled({ sessionId })
}
