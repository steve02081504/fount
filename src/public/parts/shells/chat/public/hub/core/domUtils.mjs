/**
 * 【文件】public/hub/core/domUtils.mjs
 * 【职责】Hub 消息与成员展示用的 DOM/文本工具：作者键解析、头像色、HTML 转义与时间 i18n 属性片段。
 * 【原理】为气泡头像、昵称与时间戳提供一致的视觉辅助函数；预热角色 entityHash 缓存。`authorPresentationKeys`、`escapeHtml`、`formatTimeAttrs` 等被 `messageRender` 与频道列表复用。
 * 【数据结构】hubStore 及模块内 Map/Set 字段；见 core/state 与各函数 JSDoc。
 * 【关联】../../src/lib/entityHash、../../src/lib/entityId、../../src/lib/pubKeyHex、state
 */
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import {
	avatarColor,
	avatarInitial,
	avatarTextColor,
	hashAvatarStyle,
} from '/parts/shells:chat/shared/hashAvatar.mjs'
import { aliasForEntity, aliasForGroup } from '../../shared/aliases.mjs'
import { entityHashLabel, isEntityHash128 } from '../../shared/entityHash.mjs'
import { agentEntityHash } from '../../shared/entityId.mjs'
import { isHex64, normalizeHex64 } from '../../shared/pubKeyHex.mjs'

import { hubStore } from './state.mjs'

/**
 *
 */
export { avatarColor, avatarInitial, avatarTextColor, hashAvatarStyle }

/** @type {Map<string, string>} 角色 part 名 → agent entityHash */
const charEntityHashCache = new Map()

/**
 * 当前群/私聊涉及的角色 part 名。
 * @returns {string[]} 角色 part 名列表
 */
export function activeCharPartNames() {
	const names = new Set(hubStore.context.currentState?.charPartNames || [])
	if (hubStore.privateGroup.charname)
		names.add(String(hubStore.privateGroup.charname))
	return [...names]
}

/**
 * 预计算角色 agent entityHash（供消息头像/资料 API 使用）。
 * @param {string[]} [charNames] 角色 part 名；省略则用当前群 charlist
 * @returns {Promise<void>}
 */
export async function warmCharEntityHashCache(charNames = activeCharPartNames()) {
	const members = hubStore.context.currentState?.members || []
	/** @type {Map<string, { nodeHash?: string, agentEntityHash?: string, entityHash?: string }>} */
	const agentByChar = new Map()
	for (const member of members) {
		if (member?.kind !== 'agent') continue
		const charname = String(member.charname || '').trim().toLowerCase()
		if (charname) agentByChar.set(charname, member)
	}
	for (const raw of charNames) {
		const name = String(raw || '').trim()
		if (!name || charEntityHashCache.has(name)) continue
		const member = agentByChar.get(name.toLowerCase())
		const cachedHash = member?.agentEntityHash || member?.entityHash
		if (cachedHash && isEntityHash128(String(cachedHash))) {
			charEntityHashCache.set(name, String(cachedHash).toLowerCase())
			continue
		}
		const node = member?.nodeHash || hubStore.nodeHash
		if (!node) continue
		try {
			charEntityHashCache.set(name, await agentEntityHash(node, `chars/${name}`))
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
	const members = hubStore.context.currentState?.members || []
	if (isEntityHash128(raw)) return raw
	if (!isHex64(raw)) {
		const agent = members.find(member =>
			member?.kind === 'agent'
			&& String(member.charname || '').toLowerCase() === raw.toLowerCase())
		if (agent?.entityHash && isEntityHash128(agent.entityHash))
			return String(agent.entityHash).toLowerCase()
		if (agent?.agentEntityHash && isEntityHash128(agent.agentEntityHash))
			return String(agent.agentEntityHash).toLowerCase()
		const charHash = charEntityHashFromCache(raw)
		if (charHash) return charHash
		return null
	}
	const member = members.find(m => String(m.memberKey || '').toLowerCase() === raw)
	if (member?.entityHash && isEntityHash128(member.entityHash))
		return String(member.entityHash).toLowerCase()
	const viewerPub = String(hubStore.context.currentState?.viewerMemberPubKeyHash || '').toLowerCase()
	if (viewerPub === raw && hubStore.viewer.viewerEntityHash)
		return String(hubStore.viewer.viewerEntityHash).toLowerCase()
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
	const members = hubStore.context.currentState?.members || []
	if (isHex64(raw)) {
		const member = members.find(m => String(m.memberKey || '').toLowerCase() === raw.toLowerCase())
		if (member?.displayName) return String(member.displayName).trim()
	}
	const agent = members.find(member =>
		member?.kind === 'agent'
		&& String(member.charname || '').toLowerCase() === raw.toLowerCase())
	if (agent?.displayName) return String(agent.displayName).trim()
	if (agent?.charname) return String(agent.charname).trim()
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
	const entityHash = resolveEntityHashForAuthorKey(raw)
	if (entityHash) {
		const alias = aliasForEntity(entityHash)
		if (alias) return alias
	}
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
 * 群展示名：本地别名 → 群自命名 → 「未命名群 ·xxxx」兜底。
 * @param {string} groupId 群 ID
 * @param {string} [name] 群 state 中的 name（无名时后端回落为 groupId）
 * @returns {Promise<string>} 展示名
 */
export async function groupDisplayName(groupId, name) {
	const alias = aliasForGroup(groupId)
	if (alias) return alias
	const raw = String(name || '').trim()
	if (raw && raw !== String(groupId || '')) return raw
	const { geti18n } = await import('/scripts/i18n/index.mjs')
	return geti18n('chat.hub.groupUnnamed', { suffix: String(groupId || '').slice(-4) })
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
