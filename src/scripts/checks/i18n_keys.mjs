/**
 * zh-CN（及同构 locale 树）i18n 键结构规则。
 *
 * 1. 单段 key 不得以 Suffix/Prefix 开头或结尾（应用 ${param} 整句，勿碎片硬拼）
 * 2. 同级 ≥4 个键共享同一驼峰前缀 → 须嵌套
 * 3. 字母后纯数字结尾的 key（xxx1）禁用；用有意义名或数组
 *
 * 搬键请用 .esh/commands/update_locale_data.py（见 locale-edits.md）。
 * 批量前缀嵌套写回 locale：.esh/commands/reshape_i18n_keys.py（勿用 JS 写 locale JSON，会打乱如 404 的键序）。
 */

/**
 * 搬键/改 locale 时的操作提示文案。
 */
export const UPDATE_LOCALE_DATA_HINT =
	'搬键请用 `.esh/commands/update_locale_data.py`（get → set(new) → set(old, None)），勿手改各语言 JSON。详见 src/public/locales/locale-edits.md。'

/**
 * 禁止 Suffix/Prefix 碎片硬拼时的说明文案。
 */
export const AFFIX_HINT =
	'应用 `${param}` 格式化完整句子，不要用 Suffix/Prefix 碎片硬拼字符串。'

/** 集合类单段前缀 → 复数容器名 */
export const PLURAL_CONTAINER = Object.freeze({
	tab: 'tabs',
})

/**
 * 同级键共享驼峰前缀时，触发须嵌套的最小成员数。
 */
export const PREFIX_CLUSTER_MIN = 4

const AFFIX_RE = /^(?:Suffix|Prefix)|(?:Suffix|Prefix)$/
const NUMBERED_RE = /^[A-Za-z][A-Za-z]*\d+$/
/** SCREAMING_SNAKE / 全大写常量（如 SEND_MESSAGES）——不做驼峰前缀簇嵌套 */
const SCREAMING_SNAKE_RE = /^[A-Z][A-Z0-9_]*$/

/**
 * @param {string} key 键名
 * @returns {boolean} 是否为 SCREAMING_SNAKE 常量键
 */
export function isScreamingSnakeKey(key) {
	return SCREAMING_SNAKE_RE.test(key)
}

/**
 * @param {string} key 驼峰键
 * @returns {string[]} 驼峰边界前缀（不含整键自身）
 */
export function camelPrefixes(key) {
	if (isScreamingSnakeKey(key)) return []
	/** @type {string[]} */
	const prefixes = []
	for (let index = 1; index < key.length; index++)
		if (/[A-Z]/.test(key[index])) prefixes.push(key.slice(0, index))
	return prefixes
}

/**
 * @param {string} remainder 去掉前缀后的段（首字母大写）
 * @returns {string} 子键（SCREAMING_SNAKE 保持原样，否则首字母小写）
 */
export function decapitalize(remainder) {
	if (!remainder) return remainder
	if (isScreamingSnakeKey(remainder)) return remainder
	return remainder[0].toLowerCase() + remainder.slice(1)
}

/**
 * @param {string} prefix 共享前缀
 * @returns {string} 容器键名
 */
export function containerKeyForPrefix(prefix) {
	return PLURAL_CONTAINER[prefix] ?? prefix
}

/**
 * @param {string[]} keys 同级键名
 * @param {number} [min] 成簇最小成员数
 * @returns {{ prefix: string, members: string[] }[]} 按前缀长度降序的簇（members≥阈值）
 */
export function findPrefixClusters(keys, min = PREFIX_CLUSTER_MIN) {
	/** @type {Map<string, string[]>} */
	const byPrefix = new Map()
	for (const key of keys)
		for (const prefix of camelPrefixes(key)) {
			const rest = key.slice(prefix.length)
			if (!rest || !/^[A-Z]/.test(rest)) continue
			const list = byPrefix.get(prefix) ?? []
			list.push(key)
			byPrefix.set(prefix, list)
		}
	return [...byPrefix.entries()]
		.filter(([, members]) => members.length >= min)
		.map(([prefix, members]) => ({ prefix, members: [...members].sort() }))
		.sort((a, b) => b.prefix.length - a.prefix.length || b.members.length - a.members.length || a.prefix.localeCompare(b.prefix))
}

/**
 * i18n 键结构问题。
 * @typedef {object} I18nKeyIssue
 * @property {'affix' | 'prefix_cluster' | 'numbered'} kind
 * @property {string} path 点分路径（含违规键或簇所在父路径）
 * @property {string} message 说明
 */

/**
 * 扫描一棵 locale 对象树。
 * @param {unknown} data locale JSON 根
 * @param {string} [path=''] 当前路径
 * @returns {I18nKeyIssue[]} 结构问题列表
 */
export function scanI18nKeyStructure(data, path = '') {
	if (!data || typeof data !== 'object' || Array.isArray(data))
		return []

	/** @type {I18nKeyIssue[]} */
	const issues = []
	const keys = Object.keys(/** @type {Record<string, unknown>} */ data)

	for (const key of keys) {
		const full = path ? `${path}.${key}` : key
		if (AFFIX_RE.test(key))
			issues.push({
				kind: 'affix',
				path: full,
				message: `键名「${key}」以 Suffix/Prefix 开头或结尾。${AFFIX_HINT} ${UPDATE_LOCALE_DATA_HINT}`,
			})
		if (NUMBERED_RE.test(key))
			issues.push({
				kind: 'numbered',
				path: full,
				message: `键名「${key}」以编号结尾；请用有意义的名字，如需枚举请用数组。${UPDATE_LOCALE_DATA_HINT}`,
			})
	}

	for (const { prefix, members } of findPrefixClusters(keys)) {
		const container = containerKeyForPrefix(prefix)
		const parentLabel = path || '(root)'
		issues.push({
			kind: 'prefix_cluster',
			path: parentLabel,
			message: `${parentLabel} 下有 ${members.length} 个键共享前缀「${prefix}」（${members.join(', ')}）。请嵌套为 ${container}: { ${members.map(m => decapitalize(m.slice(prefix.length))).join(', ')} }。${UPDATE_LOCALE_DATA_HINT}`,
		})
	}

	for (const key of keys) {
		const value = /** @type {Record<string, unknown>} */ data[key]
		const full = path ? `${path}.${key}` : key
		if (value && typeof value === 'object' && !Array.isArray(value))
			issues.push(...scanI18nKeyStructure(value, full))
	}

	return issues
}

/**
 * @param {Record<string, unknown>} obj 父对象
 * @param {string} prefix 前缀
 * @param {string[]} members 成员键
 * @param {string} preferredContainer 首选容器键
 * @returns {string} 可用容器键
 */
export function pickContainerName(obj, prefix, members, preferredContainer) {
	const candidates = [
		preferredContainer,
		`${preferredContainer}Items`,
		`${prefix}Items`,
	]
	for (const name of new Set(candidates))
		if (canUseContainer(obj, prefix, members, name))
			return name
	throw new Error(`无法为前缀「${prefix}」找到无冲突的容器键（尝试了 ${candidates.join(', ')}）`)
}

/**
 * @param {Record<string, unknown>} obj 父对象
 * @param {string} prefix 前缀
 * @param {string[]} members 成员键
 * @param {string} containerName 候选容器
 * @returns {boolean} 无冲突则为 true
 */
function canUseContainer(obj, prefix, members, containerName) {
	/** @type {Record<string, unknown>} */
	const bucket = {}
	const existing = obj[containerName]
	if (existing && typeof existing === 'object' && !Array.isArray(existing))
		Object.assign(bucket, /** @type {Record<string, unknown>} */ existing)
	else if (existing !== undefined && !members.includes(containerName))
		bucket.main = existing
	for (const key of members) {
		const child = decapitalize(key.slice(prefix.length))
		if (child in bucket && bucket[child] !== obj[key])
			return false
	}
	return true
}

/**
 * @param {Record<string, unknown>} obj 父对象
 * @param {string} prefix 前缀
 * @param {string[]} members 成员键
 * @param {string} preferredContainer 首选容器键
 * @param {(oldPath: string, newPath: string) => void} [onMove] 路径回调（相对父路径由调用方拼）
 * @returns {string} 实际使用的容器键
 */
export function applyPrefixNest(obj, prefix, members, preferredContainer, onMove) {
	const containerName = pickContainerName(obj, prefix, members, preferredContainer)
	/** @type {Record<string, unknown>} */
	const bucket = {}
	const existing = obj[containerName]
	if (existing && typeof existing === 'object' && !Array.isArray(existing))
		Object.assign(bucket, /** @type {Record<string, unknown>} */ existing)
	else if (existing !== undefined && !members.includes(containerName)) {
		bucket.main = existing
		onMove?.(containerName, `${containerName}.main`)
		delete obj[containerName]
	}

	for (const key of members) {
		const child = decapitalize(key.slice(prefix.length))
		bucket[child] = obj[key]
		onMove?.(key, `${containerName}.${child}`)
		delete obj[key]
	}
	obj[containerName] = bucket
	return containerName
}

/**
 * 记录嵌套前后的点分路径映射（仅叶子路径会在调用点替换时用到；也映射中间路径）。
 * 通过对比太难；改为在 nest 时显式收集。
 * @param {Record<string, unknown>} obj locale 对象
 * @param {string} [path] 当前点分路径
 * @param {Map<string, string>} [map] old → new
 * @returns {number} 嵌套次数
 */
export function nestAllPrefixClustersWithMap(obj, path = '', map = new Map()) {
	let count = 0
	for (;;) {
		const clusters = findPrefixClusters(Object.keys(obj))
		if (!clusters.length) break
		const { prefix, members } = clusters[0]
		const preferred = containerKeyForPrefix(prefix)
		applyPrefixNest(obj, prefix, members, preferred, (oldKey, newRel) => {
			const oldPath = path ? `${path}.${oldKey}` : oldKey
			const newPath = path ? `${path}.${newRel}` : newRel
			map.set(oldPath, newPath)
			for (const [from, to] of map.entries()) {
				if (from === oldPath) continue
				if (to === oldPath || to.startsWith(`${oldPath}.`))
					map.set(from, newPath + to.slice(oldPath.length))
			}
		})
		count++
	}
	for (const [key, value] of Object.entries(obj))
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			const childPath = path ? `${path}.${key}` : key
			count += nestAllPrefixClustersWithMap(/** @type {Record<string, unknown>} */ value, childPath, map)
		}
	return count
}

/**
 * 递归嵌套直到该子树无前缀簇违规。
 * @param {Record<string, unknown>} obj locale 对象
 * @returns {number} 嵌套次数
 */
export function nestAllPrefixClusters(obj) {
	return nestAllPrefixClustersWithMap(obj)
}
