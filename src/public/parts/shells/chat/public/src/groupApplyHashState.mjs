import * as Sentry from 'https://esm.sh/@sentry/browser'

import { showToastI18n } from '../../../../../scripts/toast.mjs'

import { handleUIError, normalizeError } from './utils.mjs'

/**
 * 记录并上报非 UI 错误（不弹 toast）。
 * @param {unknown} error 捕获到的错误值
 * @param {string} logPrefix console.error 前缀
 * @returns {void}
 */
function reportNonUiError(error, logPrefix) {
	const normalized = normalizeError(error)
	Sentry.captureException(normalized)
	console.error(logPrefix, normalized)
}

/**
 * 从 localStorage 恢复指定频道的 activeBranches。
 * @param {string} gId 群组 ID
 * @param {string} chId 频道 ID
 * @returns {Map<string, string>} prevMessageEventId 到选中 eventId 的映射
 */
export function loadActiveBranches(gId, chId) {
	try {
		const raw = localStorage.getItem(`fount:branches:${gId}:${chId}`)
		return new Map(raw ? JSON.parse(raw) : [])
	} catch { return new Map() }
}

/**
 * 将 activeBranches 持久化到 localStorage（最多保留 500 个分支点）。
 * @param {string} gId 群组 ID
 * @param {string} chId 频道 ID
 * @param {Map<string, string>} map 当前 activeBranches
 * @returns {void}
 */
export function saveActiveBranches(gId, chId, map) {
	try {
		const entries = [...map].slice(-500)
		localStorage.setItem(`fount:branches:${gId}:${chId}`, JSON.stringify(entries))
	} catch (e) {
		const n = e?.name
		if (n !== 'QuotaExceededError' && n !== 'SecurityError') throw e
	}
}

/**
 * 若 channelId 为 default 且服务端配置了默认频道，则设置 location.hash 并返回 true。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID（可能为 `default`）
 * @returns {Promise<boolean>} 已重定向到服务端配置的默认频道时为 true，否则为 false
 */
export async function fetchDefaultChannelRedirectIfNeeded(groupId, channelId) {
	if (channelId !== 'default') return false
	try {
		const stateR = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/state`)
		if (stateR.ok) {
			const stateData = await stateR.json()
			const configuredDefault = stateData.groupSettings?.defaultChannelId
			if (configuredDefault && configuredDefault !== 'default') {
				location.hash = `${groupId}:${configuredDefault}`
				return true
			}
		}
	}
	catch (e) {
		console.error('group default-channel state fetch failed:', e)
	}
	return false
}

/**
 * 创建当前频道的可变 UI 状态（消息列表、流式渲染、分支选择等）。
 * @param {{ groupId: string, channelId: string, signal: AbortSignal }} args 群组/频道上下文与中止信号
 * @returns {object} 频道状态对象（channelState）
 */
export function createChannelState({ groupId, channelId, signal }) {
	/** @type {object} */
	const channelState = {
		msgVirtualList: null,
		displayMessages: [],
		rawMessages: [],
		msgScrollContainer: null,
		volatileStreamEl: null,
		volatileStreamId: null,
		streamRenderer: null,
		streamNackState: new Map(),
		pendingEventMap: new Map(),
		patchScheduled: false,
		avSession: null,
		activeBranches: loadActiveBranches(groupId, channelId),
		branchInfo: new Map(),
	}

	signal.addEventListener('abort', () => {
		channelState.streamRenderer?.cancel()
		channelState.streamRenderer = null
		channelState.volatileStreamEl?.remove()
		channelState.volatileStreamEl = null
		channelState.volatileStreamId = null
		channelState.streamNackState.clear()
		channelState.msgVirtualList?.destroy()
		channelState.msgVirtualList = null
	})

	return channelState
}

/**
 * 增量拉取群组 DAG 事件并更新本地 `since` 游标（用于跨标签页/刷新后的轻量同步）。
 * @param {string} groupId 群组 ID
 * @returns {Promise<void>}
 */
export async function pullIncrementalDagEvents(groupId) {
	const key = `group:lastSyncedEvent:${groupId}`
	const since = sessionStorage.getItem(key) || ''
	const qs = new URLSearchParams({ limit: '120' })
	if (since) qs.set('since', since)
	try {
		const r = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/events?${qs}`)
		if (!r.ok) {
			reportNonUiError(new Error(`pullIncrementalDagEvents HTTP ${r.status}`), 'pullIncrementalDagEvents failed:')
			return
		}
		const { events, truncated } = await r.json()
		if (Array.isArray(events) && events.length) {
			const last = events.at(-1)
			if (last?.id) sessionStorage.setItem(key, last.id)
		}
		if (truncated)
			showToastI18n('warning', 'chat.group.syncTruncatedHint')
	}
	catch (e) {
		reportNonUiError(e, 'pullIncrementalDagEvents failed:')
	}
}

/**
 * 拉取群组 state（频道树、成员、设置等）。
 * @param {string} groupId 群组 ID
 * @returns {Promise<object | null>} 成功时为 state JSON；失败时为 null
 */
export async function fetchGroupStateData(groupId) {
	try {
		const r = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/state`)
		if (!r.ok) {
			handleUIError(new Error(`loadState HTTP ${r.status}`), 'chat.group.loadError', 'loadState failed')
			return null
		}
		return await r.json()
	}
	catch (e) {
		handleUIError(e, 'chat.group.loadError', 'loadState failed')
		return null
	}
}

/**
 * 拉取可用于 @mention 的角色名列表。
 * @param {string} groupId 群组 ID
 * @returns {Promise<string[]>} 角色名数组（失败时为空数组）
 */
export async function fetchMentionCharNames(groupId) {
	try {
		const r = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/chars`)
		if (r.ok) {
			const j = await r.json()
			return Array.isArray(j) ? j : []
		}
	}
	catch (e) {
		reportNonUiError(e, 'group mention chars fetch failed:')
	}
	return []
}

/** 成员分页预取：最多请求的页数（page 0 … max-1），防止未知总页数时死循环 */
const PRELOAD_MEMBER_AVATAR_MAX_PAGES = 50
/** 相邻两页 members 请求之间的间隔（串行 + 节流） */
const PRELOAD_MEMBER_AVATAR_PAGE_DELAY_MS = 75

/**
 * 从 members 分页接口 JSON 中取出成员数组。
 * @param {unknown} data 原始响应体（数组或带 `members` 的对象）
 * @returns {object[]} 成员对象数组；无法识别时为空数组
 */
function membersPageListFromJson(data) {
	if (Array.isArray(data)) return data
	if (data && typeof data === 'object' && Array.isArray(/** @type {{ members?: unknown }} */ data.members))
		return /** @type {{ members: object[] }} */ data.members
	return []
}

/**
 * 从分页 JSON 中读取总页数（兼容 `pagesCount` / `members_pages_count` / `totalPages`）。
 * @param {unknown} data 原始响应体
 * @returns {number | null} 总页数（>=1）；无法解析时为 `null`
 */
function membersPagesCountFromJson(data) {
	if (!data || typeof data !== 'object') return null
	const o = /** @type {Record<string, unknown>} */ data
	const raw = o.pagesCount ?? o.members_pages_count ?? o.totalPages
	if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
	const n = Math.floor(raw)
	return n >= 1 ? n : null
}

/**
 * 将一页成员写入头像缓存（按 hash / memberId / 显示名）。
 * @param {object[]} list 当前页成员列表
 * @param {Map<string, string>} memberAvatarCache 群级头像缓存 Map
 * @returns {void}
 */
function applyMemberAvatarsPage(list, memberAvatarCache) {
	for (const m of list) {
		const avatar = m.profile?.avatar || m.avatar || m.profile?.avatarUrl || m.profile?.icon
		if (!avatar) continue
		const { pubKeyHash: hash } = m
		if (hash) memberAvatarCache.set(hash, avatar)
		const mid = m.profile?.memberId ?? m.memberId
		if (mid) memberAvatarCache.set(mid, avatar)
		const name = m.profile?.name
		if (name) memberAvatarCache.set(name, avatar)
	}
}

/**
 * 预加载群成员头像到缓存（pubKeyHash / memberId / 显示名 等键）。
 * @param {string} groupId 群组 ID
 * @param {Map<string, string>} memberAvatarCache 成员键到头像 URL 的缓存
 * @param {() => void} refreshVirtualList 缓存更新后刷新消息虚拟列表
 * @returns {Promise<void>}
 */
export async function preloadMemberAvatars(groupId, memberAvatarCache, refreshVirtualList) {
	const base = `/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/members/page/`
	let sentryReported = false
	/**
	 * 整个预加载流程中最多向 Sentry 上报一次。
	 * @param {unknown} err 异常或非 Error 的失败信息
	 * @returns {void}
	 */
	const reportOnce = (err) => {
		if (sentryReported) return
		sentryReported = true
		Sentry.captureException(normalizeError(err))
	}
	/**
	 * 在相邻两页请求之间等待固定间隔。
	 * @returns {Promise<void>} 在 `PRELOAD_MEMBER_AVATAR_PAGE_DELAY_MS` 后 resolve
	 */
	const sleepBetweenPages = () => new Promise((resolve) => {
		setTimeout(resolve, PRELOAD_MEMBER_AVATAR_PAGE_DELAY_MS)
	})
	try {
		const r0 = await fetch(base + '0')
		if (!r0.ok) {
			reportOnce(new Error(`preloadMemberAvatars page0 HTTP ${r0.status}`))
			return
		}
		const data0 = await r0.json()
		const list0 = membersPageListFromJson(data0)
		applyMemberAvatarsPage(list0, memberAvatarCache)

		let pagesTotal = membersPagesCountFromJson(data0)
		let nextPage = 1
		while (nextPage < PRELOAD_MEMBER_AVATAR_MAX_PAGES) {
			const cap = pagesTotal == null ? null : Math.min(pagesTotal, PRELOAD_MEMBER_AVATAR_MAX_PAGES)
			if (cap != null && nextPage >= cap) break
			await sleepBetweenPages()
			const r = await fetch(base + String(nextPage))
			if (r.status === 404) break
			if (!r.ok) break
			const data = await r.json()
			const list = membersPageListFromJson(data)
			if (!list.length) break
			applyMemberAvatarsPage(list, memberAvatarCache)
			if (pagesTotal == null) {
				const hint = membersPagesCountFromJson(data)
				if (hint != null) pagesTotal = hint
			}
			nextPage++
		}
	}
	catch (e) {
		reportOnce(e)
	}
	void refreshVirtualList?.()
}

/**
 * 创建群组 hash 流程中的跨频道 UI 切片（频道元数据缓存、已打开频道集合、头像缓存等）。
 * @param {string} groupId 群组 ID
 * @param {string} channelId 当前频道 ID（用于初始化 `openedChannels`）
 * @returns {{
 *   lastChannels: Record<string, object>,
 *   lastChannelMeta: object | null,
 *   lastGroupSettings: object,
 *   openedChannels: Set<string>,
 *   memberAvatarCache: Map<string, string>,
 * }} 可变的 apply-hash 状态切片
 */
export function createApplyGroupStateSlice(groupId, channelId) {
	return {
		lastChannels: {},
		lastChannelMeta: null,
		lastGroupSettings: {},
		openedChannels: new Set([channelId]),
		memberAvatarCache: new Map(),
	}
}
