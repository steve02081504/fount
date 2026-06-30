/**
 * 【文件】public/hub/hubStatus.mjs
 * 【职责】当前用户在线状态：心跳、idle 检测、状态菜单与顶栏状态点/自定义状态文案同步。
 * 【原理】`applyMyStatusUI`、`showStatusMenu` 更新 `#hub-my-status` 等区域；`startHeartbeat` 维持 presence。
 * 【数据结构】hubStore 及模块内 Map/Set 字段；见 core/state 与各函数 JSDoc。
 * 【关联】../../../../scripts/i18n、../../../../scripts/toast、core/state、presence
 */
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { geti18n } from '../../../../scripts/i18n/index.mjs'

import { hubStore } from './core/state.mjs'
import {
	applySelfStatusToMemberList,
	applyStatusDot,
	fetchUserProfile,
	formatStatusLabel,
	invalidateUserProfileCache,
} from './presence.mjs'

/** @type {ReturnType<typeof setInterval> | null} */
let heartbeatTimer = null
/** @type {ReturnType<typeof setTimeout> | null} */
let idleTimer = null
/** @type {string} */
let lastManualStatus = 'online'
/** @type {HTMLElement | null} */
let openStatusMenuEl = null

const MANUAL_STATUSES = ['online', 'idle', 'dnd', 'invisible']

/**
 * @param {string} status 状态键
 * @param {string} [customStatus] 自定义状态文案
 * @returns {Promise<void>}
 */
export async function applyMyStatusUI(status, customStatus = '') {
	const dot = document.getElementById('hub-my-status-dot')
	const text = document.getElementById('hub-my-status-text')
	applyStatusDot(dot, status)
	if (text)
		text.textContent = await formatStatusLabel(status, customStatus)
}

/**
 * @param {string} entityHash 当前 viewer 的 128 位 entityHash
 * @returns {Promise<void>}
 */
export async function sendHeartbeat(entityHash) {
	if (!entityHash) return
	await fetch(`/api/p2p/entities/${encodeURIComponent(entityHash)}/heartbeat`, {
		method: 'POST',
		credentials: 'include',
	})
}

/**
 * @param {string} status 要设置的状态
 * @param {{ silent?: boolean }} [options] silent 为 true 时不 toast 错误
 * @returns {Promise<void>}
 */
export async function setMyStatus(status, options = {}) {
	const entityHash = hubStore.viewerEntityHash
	if (!entityHash) return
	const resp = await fetch(`/api/p2p/entities/${encodeURIComponent(entityHash)}/status`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({ status }),
	})
	if (!resp.ok) {
		if (!options.silent) {
			const data = await resp.json().catch(() => ({}))
			showToastI18n('error', 'chat.hub.operationFailed', { error: data.error || resp.statusText })
		}
		return
	}
	if (MANUAL_STATUSES.includes(status))
		lastManualStatus = status
	invalidateUserProfileCache(entityHash)
	const profile = await fetchUserProfile(entityHash, {
		bypassCache: true,
		groupId: hubStore.currentGroupId || undefined,
	})
	await applyMyStatusUI(status, profile?.customStatus || '')
	applySelfStatusToMemberList(status)
}

/**
 * @param {string} entityHash 当前 viewer 的 128 位 entityHash
 * @returns {Promise<void>}
 */
export async function refreshMyStatusFromProfile(entityHash) {
	const profile = await fetchUserProfile(entityHash, {
		bypassCache: true,
		groupId: hubStore.currentGroupId || undefined,
	})
	if (!profile) return
	const stored = profile.status === 'offline' && MANUAL_STATUSES.includes(lastManualStatus)
		? lastManualStatus
		: profile.status
	if (MANUAL_STATUSES.includes(stored))
		lastManualStatus = stored
	await applyMyStatusUI(profile.status, profile.customStatus)
	applySelfStatusToMemberList(profile.status)
}

/**
 * 进群或切换 viewer 后：刷新心跳与成员列表中的自身状态。
 * @param {string} entityHash 当前 viewer 的 128 位 entityHash
 * @returns {Promise<void>}
 */
export async function syncViewerPresence(entityHash) {
	if (!entityHash) return
	invalidateUserProfileCache(entityHash)
	await sendHeartbeat(entityHash)
	await refreshMyStatusFromProfile(entityHash)
	startHeartbeat(entityHash)
}

/**
 * @param {string} entityHash 当前 viewer 的 128 位 entityHash
 * @returns {void}
 */
export function startHeartbeat(entityHash) {
	if (heartbeatTimer) clearInterval(heartbeatTimer)
	void sendHeartbeat(entityHash)
	heartbeatTimer = setInterval(() => {
		void sendHeartbeat(entityHash)
	}, 60_000)
}

/**
 * @returns {void}
 */
export function startIdleWatcher() {
	document.addEventListener('visibilitychange', () => {
		if (document.hidden)
			idleTimer = setTimeout(() => {
				void setMyStatus('idle', { silent: true })
			}, 5 * 60 * 1000)
		else {
			if (idleTimer) clearTimeout(idleTimer)
			idleTimer = null
			const restore = lastManualStatus === 'invisible' ? 'invisible' : lastManualStatus || 'online'
			void setMyStatus(restore, { silent: true })
			void sendHeartbeat(hubStore.viewerEntityHash)
		}
	})
}

/** @returns {void} */
function dismissStatusMenu() {
	if (!openStatusMenuEl) return
	openStatusMenuEl.remove()
	openStatusMenuEl = null
}

/**
 * @param {HTMLElement} anchorEl user bar 或状态行
 * @returns {Promise<void>}
 */
export async function showStatusMenu(anchorEl) {
	dismissStatusMenu()
	const rect = anchorEl.getBoundingClientRect()
	const menu = document.createElement('ul')
	menu.className = 'menu menu-sm bg-base-100 rounded-box shadow-lg border border-base-300 p-1 z-50'
	menu.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top - 4}px;transform:translateY(-100%);min-width:11rem;`

	for (const status of MANUAL_STATUSES) {
		const li = document.createElement('li')
		const statusOptionButton = document.createElement('button')
		statusOptionButton.type = 'button'
		statusOptionButton.className = 'flex items-center gap-2 w-full'
		const dot = document.createElement('span')
		dot.className = 'hub-status-dot shrink-0'
		applyStatusDot(dot, status)
		const label = document.createElement('span')
		label.textContent = await geti18n(`chat.hub.status.${status}`)
		statusOptionButton.append(dot, label)
		statusOptionButton.addEventListener('click', () => {
			dismissStatusMenu()
			void setMyStatus(status)
		})
		li.append(statusOptionButton)
		menu.append(li)
	}

	const profileLi = document.createElement('li')
	const profileBtn = document.createElement('a')
	profileBtn.href = '/parts/shells:chat/profile'
	profileBtn.className = 'px-3 py-2 text-sm'
	profileBtn.textContent = await geti18n('chat.hub.profileLinkTitle.title')
	profileBtn.addEventListener('click', (clickEvent) => clickEvent.stopPropagation())
	profileLi.append(profileBtn)
	menu.append(profileLi)

	document.body.append(menu)
	openStatusMenuEl = menu

	/**
	 * 关闭在线状态菜单并移除文档级点击监听。
	 * @returns {void}
	 */
	const closeOnce = () => {
		dismissStatusMenu()
		document.removeEventListener('click', closeOnce, true)
	}
	setTimeout(() => document.addEventListener('click', closeOnce, true), 0)
}
