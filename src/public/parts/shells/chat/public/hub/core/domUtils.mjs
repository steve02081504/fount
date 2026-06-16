/**
 * 【文件】public/hub/core/domUtils.mjs
 * 【职责】Hub 消息与成员展示用的 DOM/文本工具：作者键解析、头像色、HTML 转义与时间 i18n 属性片段。
 * 【原理】为气泡头像、昵称与时间戳提供一致的视觉辅助函数；预热角色 entityHash 缓存。`authorPresentationKeys`、`escapeHtml`、`formatTimeAttrs` 等被 `messageRender` 与频道列表复用。
 * 【数据结构】hubStore 及模块内 Map/Set 字段；见 core/state 与各函数 JSDoc。
 * 【关联】../../src/lib/entityHash、../../src/lib/entityId、../../src/lib/pubKeyHex、state
 */
import { entityHashLabel, isEntityHash128 } from '../../src/lib/entityHash.mjs'
import { agentEntityHash } from '../../src/lib/entityId.mjs'
import { isHex64, normalizeHex64 } from '../../src/lib/pubKeyHex.mjs'

import { hubStore } from './state.mjs'

/** @type {Map<string, string>} 角色 part 名 → agent entityHash */
const charEntityHashCache = new Map()

/**
 * 当前群/私聊涉及的角色 part 名。
 * @returns {string[]} 角色 part 名列表
 */
export function activeCharPartNames() {
	const names = new Set(hubStore.currentState?.charPartNames || [])
	if (hubStore.privateGroup.charName)
		names.add(String(hubStore.privateGroup.charName))
	return [...names]
}

/**
 * 预计算角色 agent entityHash（供消息头像/资料 API 使用）。
 * @param {string[]} [charNames] 角色 part 名；省略则用当前群 charlist
 * @returns {Promise<void>}
 */
export async function warmCharEntityHashCache(charNames = activeCharPartNames()) {
	const { nodeHash } = hubStore
	if (!nodeHash) return
	for (const raw of charNames) {
		const name = String(raw || '').trim()
		if (!name || charEntityHashCache.has(name)) continue
		try {
			charEntityHashCache.set(name, await agentEntityHash(nodeHash, `chars/${name}`))
		}
		catch {
			/* 忽略无效角色名 */
		}
	}
}

/**
 * @param {string} [charname] 角色 part 名
 * @returns {string|null} 128 位 entityHash
 */
export function charEntityHashFromCache(charname) {
	const name = String(charname || '').trim()
	if (!name) return null
	const cached = charEntityHashCache.get(name)
	return cached && isEntityHash128(cached) ? cached.toLowerCase() : null
}

/**
 * 从当前群成员表解析发送者对应的 entityHash（用于资料 API）。
 * @param {string} [key] pubKeyHash / entityHash / 角色 part 名
 * @returns {string|null} 128 位 entityHash；无法解析时为 null
 */
export function resolveEntityHashForAuthorKey(key) {
	const raw = String(key ?? '').trim().toLowerCase()
	if (!raw) return null
	if (isEntityHash128(raw)) return raw
	if (!isHex64(raw)) {
		const charHash = charEntityHashFromCache(raw)
		if (charHash) return charHash
		return null
	}
	const members = hubStore.currentState?.members || []
	const member = members.find(m => String(m.pubKeyHash || '').toLowerCase() === raw)
	if (member?.entityHash && isEntityHash128(member.entityHash))
		return String(member.entityHash).toLowerCase()
	const viewerPub = String(hubStore.currentState?.viewerMemberPubKeyHash || '').toLowerCase()
	if (viewerPub === raw && hubStore.viewerEntityHash)
		return String(hubStore.viewerEntityHash).toLowerCase()
	return null
}

/**
 * 从当前群成员表解析展示名（优先 displayName）。
 * @param {string} [key] pubKeyHash / entityHash / 角色 part 名
 * @returns {string|null} 展示名；无匹配时为 null
 */
export function memberDisplayNameForAuthorKey(key) {
	const raw = String(key ?? '').trim()
	if (!raw) return null
	const members = hubStore.currentState?.members || []
	if (isHex64(raw)) {
		const member = members.find(m => String(m.pubKeyHash || '').toLowerCase() === raw.toLowerCase())
		if (member?.displayName) return String(member.displayName).trim()
	}
	return null
}

/**
 * 将发送者键（entityHash / pubKeyHash / 角色 part 名）转为可读展示名。
 * @param {string} [key] 原始发送者标识
 * @returns {string} 可读展示名
 */
export function authorDisplayLabel(key) {
	const raw = String(key ?? '').trim()
	if (!raw || raw === '?') return '?'
	const fromMember = memberDisplayNameForAuthorKey(raw)
	if (fromMember) return fromMember
	if (isEntityHash128(raw)) return entityHashLabel(raw)
	if (isHex64(raw)) {
		const hex = normalizeHex64(raw)
		return `${hex.slice(0, 8)}…${hex.slice(-4)}`
	}
	if (raw.length > 28) return `${raw.slice(0, 12)}…${raw.slice(-4)}`
	return raw
}

/**
 * 消息/头像用的展示名与 entityHash 解析键。
 * @param {string} [authorKey] sender / charId / entityHash
 * @returns {{ displayName: string, profileKey: string }} 展示名与资料 API 键
 */
export function authorPresentationKeys(authorKey) {
	const key = String(authorKey ?? '').trim()
	const displayName = authorDisplayLabel(key)
	const profileKey = resolveEntityHashForAuthorKey(key) || key
	return { displayName, profileKey }
}

/**
 * 将文本转为可安全插入 HTML 的字符串。
 * @param {string|null|undefined} text 原始文本
 * @returns {string} 转义后的 HTML 片段
 */
export function escapeHtml(text) {
	const div = document.createElement('div')
	div.textContent = text == null ? '' : String(text)
	return div.innerHTML
}

/** 头像调色板（daisyUI 语义色 CSS 变量名） */
const AVATAR_COLOR_VARS = [
	'--color-primary', '--color-error', '--color-warning', '--color-success',
	'--color-accent', '--color-secondary', '--color-info', '--color-neutral',
]

/**
 * 根据名称生成稳定的头像背景色。
 * @param {string} [name] 用户名或展示名
 * @returns {string} CSS 颜色值
 */
export function avatarColor(name) {
	let hash = 0
	const label = name || ''
	for (let charIndex = 0; charIndex < label.length; charIndex++)
		hash = label.charCodeAt(charIndex) + ((hash << 5) - hash)
	const varName = AVATAR_COLOR_VARS[Math.abs(hash) % AVATAR_COLOR_VARS.length]
	const resolved = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
	return resolved || `var(${varName})`
}

/**
 * 取名称首字符作为头像占位字母。
 * @param {string} [name] 用户名或展示名
 * @returns {string} 单个大写字母
 */
export function avatarInitial(name) {
	return (name || '?').charAt(0).toUpperCase()
}

/**
 * 将时间戳格式化为消息头可用的 i18n 属性（由 `data-i18n` 渲染）。
 * @param {number} timestamp 毫秒时间戳
 * @returns {{ timeI18n: string, timeParam: string, timeText: string }} `timeI18n` 为空时用 `timeText`
 */
export function formatTimeAttrs(timestamp) {
	const date = new Date(timestamp)
	const now = new Date()
	const clock = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
	if (date.toDateString() === now.toDateString())
		return { timeI18n: 'chat.hub.timeToday', timeParam: clock, timeText: '' }
	const yesterday = new Date(now)
	yesterday.setDate(now.getDate() - 1)
	if (date.toDateString() === yesterday.toDateString())
		return { timeI18n: 'chat.hub.timeYesterday', timeParam: clock, timeText: '' }
	return { timeI18n: '', timeParam: '', timeText: `${date.toLocaleDateString()} ${clock}` }
}

/**
 * @param {{ timeI18n: string, timeParam: string, timeText: string }} attrs `formatTimeAttrs` 返回值
 * @returns {string} 可插入模板的 `data-i18n` 属性片段
 */
export function timeI18nAttrFragment(attrs) {
	if (!attrs?.timeI18n) return ''
	const time = escapeHtml(attrs.timeParam)
	return ` data-i18n="${attrs.timeI18n}" data-time="${time}"`
}
