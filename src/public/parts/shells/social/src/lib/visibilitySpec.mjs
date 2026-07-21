/**
 * Social 可见性档位规范化、偏序与读侧判定核心。
 */

import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'

/** @typedef {'public' | 'unlisted' | 'followers' | 'followers_since' | 'selected' | 'private'} SocialVisibility */

/** 合法可见性档位 */
export const SOCIAL_VISIBILITIES = new Set([
	'public',
	'unlisted',
	'followers',
	'followers_since',
	'selected',
	'private',
])

/** UI 预设 → 规范档位 */
export const VISIBILITY_UI_PRESETS = {
	followers_7d: { visibility: 'followers_since', minFollowMs: 7 * 24 * 60 * 60 * 1000 },
	followers_30d: { visibility: 'followers_since', minFollowMs: 30 * 24 * 60 * 60 * 1000 },
}

/** 偏序基数：越大越严 */
const STRICTNESS_BASE = {
	public: 0,
	unlisted: 1,
	followers: 2,
	followers_since: 3,
	selected: 4,
	private: 5,
}

/**
 * @param {unknown} raw 原始哈希列表
 * @returns {string[]} 清洗后的 entityHash 列表
 */
function normalizeEntityHashList(raw) {
	if (!Array.isArray(raw)) return []
	const out = []
	const seen = new Set()
	for (const item of raw) {
		const hash = String(item || '').trim().toLowerCase()
		if (!isEntityHash128(hash) || seen.has(hash)) continue
		seen.add(hash)
		out.push(hash)
	}
	return out
}

/**
 * 规范化可见性草稿（含 UI 预设展开）。
 * @param {object | string} [draft] 草稿或档位字符串
 * @returns {{ visibility: SocialVisibility, minFollowMs?: number, allow?: string[], except?: string[] }} 规范 spec
 */
export function normalizeVisibilitySpec(draft = {}) {
	const raw = typeof draft === 'string' ? { visibility: draft } : draft || {}
	const presetKey = String(raw.visibility || raw.preset || '').trim()
	const preset = VISIBILITY_UI_PRESETS[presetKey]
	let visibility = /** @type {SocialVisibility} */ 
		preset ? preset.visibility : String(raw.visibility || 'public').trim()
	
	if (!SOCIAL_VISIBILITIES.has(visibility)) visibility = 'public'

	/** @type {{ visibility: SocialVisibility, minFollowMs?: number, allow?: string[], except?: string[] }} */
	const spec = { visibility }

	if (visibility === 'followers_since') {
		const ms = Number(raw.minFollowMs ?? preset?.minFollowMs)
		spec.minFollowMs = Number.isFinite(ms) && ms > 0
			? Math.floor(ms)
			: VISIBILITY_UI_PRESETS.followers_7d.minFollowMs
	}

	if (visibility === 'selected') 
		spec.allow = normalizeEntityHashList(raw.allow)
	

	if (visibility === 'private') 
		spec.allow = []
	

	if (visibility === 'public' || visibility === 'unlisted' || visibility === 'followers' || visibility === 'followers_since') {
		const except = normalizeEntityHashList(raw.except)
		if (except.length) spec.except = except
	}

	return spec
}

/**
 * 从帖/相册 content 抽取可见性 spec（信封外层或明文）。
 * @param {object | null | undefined} content content
 * @returns {{ visibility: SocialVisibility, minFollowMs?: number, allow?: string[], except?: string[] }} spec
 */
export function visibilitySpecFromContent(content) {
	return normalizeVisibilitySpec({
		visibility: content?.visibility,
		minFollowMs: content?.minFollowMs,
		allow: content?.allow,
		except: content?.except,
	})
}

/**
 * 比较两个可见性档位的严格程度。
 * @param {object | string} a 档位或 spec
 * @param {object | string} b 档位或 spec
 * @returns {number} <0 a 更公开；0 同级；>0 a 更严
 */
export function compareVisibilityStrictness(a, b) {
	const left = normalizeVisibilitySpec(a)
	const right = normalizeVisibilitySpec(b)
	const leftBase = STRICTNESS_BASE[left.visibility] ?? 0
	const rightBase = STRICTNESS_BASE[right.visibility] ?? 0
	if (leftBase !== rightBase) return leftBase - rightBase
	if (left.visibility === 'followers_since')
		return (left.minFollowMs || 0) - (right.minFollowMs || 0)
	return 0
}

/**
 * 取多个 spec 中最公开的一个。
 * @param {Array<object | string>} specs specs
 * @returns {ReturnType<typeof normalizeVisibilitySpec> | null} 最公开；空列表为 null
 */
export function minVisibilitySpec(specs) {
	let best = null
	for (const item of specs) {
		const spec = normalizeVisibilitySpec(item)
		if (!best || compareVisibilityStrictness(spec, best) < 0) best = spec
	}
	return best
}

/**
 * 是否仅应进入公开发现面（探索/热搜/搜索联邦/短视频发现）。
 * @param {object | string | null | undefined} contentOrSpec content 或 spec
 * @returns {boolean} 是否 public
 */
export function isPublicDiscoverable(contentOrSpec) {
	const visibility = typeof contentOrSpec === 'string'
		? contentOrSpec
		: contentOrSpec?.visibility || 'public'
	return visibility === 'public' || !visibility
}

/**
 * 可见性读侧判定（不含个人拉黑/关键词；那些由 canViewPost 叠）。
 * @param {object} content 帖/相册 content（含 visibility 字段）
 * @param {object} viewerContext 观看者上下文
 * @param {string} ownerEntityHash 作者/相册 owner
 * @returns {boolean} 是否可见
 */
export function canViewByVisibility(content, viewerContext, ownerEntityHash) {
	const owner = String(ownerEntityHash || '').toLowerCase()
	const viewer = String(viewerContext?.viewerEntityHash || '').toLowerCase() || null
	if (viewer && viewer === owner) return true

	const spec = visibilitySpecFromContent(content)
	if (viewer && spec.except?.includes(viewer)) return false

	switch (spec.visibility) {
		case 'public':
		case 'unlisted':
			return true
		case 'followers':
			return Boolean(viewer && viewerContext.following?.has(owner))
		case 'followers_since': {
			if (!viewer || !viewerContext.following?.has(owner)) return false
			const followWall = viewerContext.followSince?.get(owner)
			if (followWall == null) return false
			const at = Number(viewerContext.at) || Date.now()
			return at - followWall >= (spec.minFollowMs || 0)
		}
		case 'selected':
			return Boolean(viewer && spec.allow?.includes(viewer))
		case 'private':
			return false
		default:
			return true
	}
}

/**
 * 两个可见性 spec 是否语义相等（用于 reconcile 跳过）。
 * @param {object | string} a a
 * @param {object | string} b b
 * @returns {boolean} 相等
 */
export function visibilitySpecsEqual(a, b) {
	const left = normalizeVisibilitySpec(a)
	const right = normalizeVisibilitySpec(b)
	if (left.visibility !== right.visibility) return false
	if ((left.minFollowMs || 0) !== (right.minFollowMs || 0)) return false
	const leftAllow = [...left.allow || []].sort().join(',')
	const rightAllow = [...right.allow || []].sort().join(',')
	if (leftAllow !== rightAllow) return false
	const leftExcept = [...left.except || []].sort().join(',')
	const rightExcept = [...right.except || []].sort().join(',')
	return leftExcept === rightExcept
}

/**
 * 将规范 spec 展开到 content 字段（剔除缺省）。
 * @param {ReturnType<typeof normalizeVisibilitySpec>} spec spec
 * @returns {object} content 片段
 */
export function visibilitySpecToContentFields(spec) {
	const normalized = normalizeVisibilitySpec(spec)
	/** @type {object} */
	const fields = { visibility: normalized.visibility }
	if (normalized.visibility === 'followers_since')
		fields.minFollowMs = normalized.minFollowMs
	if (normalized.visibility === 'selected')
		fields.allow = [...normalized.allow || []]
	if (normalized.except?.length)
		fields.except = [...normalized.except]
	return fields
}
