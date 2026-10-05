/**
 * zh-CN（及同构 locale 树）i18n 键结构规则。
 *
 * 1. 单段 key 不得以 Suffix/Prefix 开头或结尾（应用 ${param} 整句，勿碎片硬拼）
 * 2. 同级 ≥4 个键共享同一驼峰前缀 → 须嵌套
 * 3. 字母后纯数字结尾的 key（xxx1）禁用；用有意义名或数组
 * 4. 各语言与 zh-CN 在共有路径上类型须一致（string ↔ object 会导致 UI 空白 / aria 丢失）。
 *    例外：string ↔ switch 叶子（`{ switch, default, cases? }`）兼容，允许仅部分语言使用单复数分支。
 * 5. 各语言的键集须覆盖 zh-CN（漏掉的键在 bundle 里根本不存在，取用时回落键名本身、无兜底），
 *    且不得多出 zh-CN 没有的叶子（同步残渣 / 已删键的遗留）。
 *
 * 搬键请用 .esh/commands/update_locale_data.py（见 locale-edits.md）。
 * 批量前缀嵌套写回 locale：.esh/commands/reshape_i18n_keys.py（勿用 JS 写 locale JSON，会打乱如 404 的键序）。
 * string → `{ aria-label }` 等单 applicator 包装见 locale-edits.md；`update-locales.py` 同步时也会规范化并在残留类型不匹配时 exit 1。
 */

import { extractPlaceholders } from '../../public/pages/scripts/i18n/placeholders.mjs'
import { areLocaleLeafKindsCompatible, isSwitchValue } from '../i18n/switch_value.mjs'

/**
 * 搬键/改 locale 时的操作提示文案。
 */
export const UPDATE_LOCALE_DATA_HINT =
	'搬键请用 `.esh/commands/update_locale_data.py`（get → set(new) → set(old, None)），勿手改各语言 JSON。详见 src/public/locales/docs/locale-edits.md。'

/**
 * 禁止 Suffix/Prefix 碎片硬拼时的说明文案。
 */
export const AFFIX_HINT =
	'应用 `${param}` 格式化完整句子，不要用 Suffix/Prefix 碎片硬拼字符串。'

/** 集合类单段前缀 → 复数容器名 */
export const PLURAL_CONTAINER = {
	tab: 'tabs',
}

/**
 * 同级键共享驼峰前缀时，触发须嵌套的最小成员数。
 */
export const PREFIX_CLUSTER_MIN = 4

const AFFIX_RE = /^(?:Suffix|Prefix)|(?:Suffix|Prefix)$/
const NUMBERED_RE = /^[A-Za-z]+\d+$/
/** SCREAMING_SNAKE / 全大写常量（如 SEND_MESSAGES）——不做驼峰前缀簇嵌套 */
const SCREAMING_SNAKE_RE = /^[A-Z][\dA-Z_]*$/

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
 * @property {'affix' | 'prefix_cluster' | 'numbered' | 'type_mismatch' | 'placeholder_mismatch' | 'missing_key' | 'missing_node' | 'extra_key' | 'extra_node' | 'forbidden_script'} kind
 * @property {string} path 点分路径（含违规键或簇所在父路径）
 * @property {string} message 说明
 */

/** 汉字独立判定（emoji 文案的复制粘贴痕迹只看汉字，拉丁指令、假名外借词不算）。 */
export const HAN_RE = /\p{Script=Han}/u

/** emoji.json 禁止汉字 / 假名 / 西里尔；拉丁仅用于命令、快捷键、插值名 */
export const EMOJI_LOCALE_FORBIDDEN_RE = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Cyrillic}/u

/**
 * 扫描 emoji 语种树中含禁止文字脚本的字符串。
 * @param {unknown} data locale 节点
 * @param {string} [path=''] 当前点分路径
 * @returns {I18nKeyIssue[]} 禁止脚本问题
 */
export function scanEmojiLocaleForbiddenScript(data, path = '') {
	/** @type {I18nKeyIssue[]} */
	const issues = []
	if (typeof data === 'string') {
		const match = data.match(EMOJI_LOCALE_FORBIDDEN_RE)
		if (match)
			issues.push({
				kind: 'forbidden_script',
				path: path || '(root)',
				message: `emoji 文案含禁止脚本「${match[0]}」。emoji 语种须用 emoji（拉丁仅用于命令 / 快捷键 / 插值）。`,
			})
		return issues
	}
	if (Array.isArray(data)) {
		for (let index = 0; index < data.length; index++)
			issues.push(...scanEmojiLocaleForbiddenScript(data[index], `${path}[${index}]`))
		return issues
	}
	if (data && typeof data === 'object')
		for (const [key, value] of Object.entries(data)) {
			const child = path ? `${path}.${key}` : key
			issues.push(...scanEmojiLocaleForbiddenScript(value, child))
		}
	return issues
}

/**
 * @param {unknown} value locale 节点
 * @returns {'null' | 'array' | 'object' | 'string' | 'number' | 'boolean' | 'undefined' | string} 粗粒度类型名
 */
export function localeValueKind(value) {
	if (value === null) return 'null'
	if (value === undefined) return 'undefined'
	if (Array.isArray(value)) return 'array'
	if (isSwitchValue(value)) return 'switch'
	const type = typeof value
	if (type === 'object') return 'object'
	return type
}

/**
 * 对照参考 locale，扫描另一语言在共有路径上的类型不一致。
 * @param {unknown} reference 参考树（通常 zh-CN）
 * @param {unknown} other 待检树
 * @param {string} [path=''] 当前点分路径
 * @returns {I18nKeyIssue[]} 类型不匹配列表
 */
export function scanLocaleTreeShape(reference, other, path = '') {
	/** @type {I18nKeyIssue[]} */
	const issues = []
	if (reference === undefined || other === undefined) return issues

	if (areLocaleLeafKindsCompatible(reference, other)) return issues

	const refKind = localeValueKind(reference)
	const otherKind = localeValueKind(other)
	if (refKind !== otherKind) {
		issues.push({
			kind: 'type_mismatch',
			path: path || '(root)',
			message: `类型不匹配：参考为 ${refKind}，此处为 ${otherKind}。请用 update_locale_data 对齐结构（string→单 applicator 对象见 locale-edits.md），或跑 update-locales.py 规范化。${UPDATE_LOCALE_DATA_HINT}`,
		})
		return issues
	}

	if (refKind === 'object') {
		const refObj = /** @type {Record<string, unknown>} */ reference
		const otherObj = /** @type {Record<string, unknown>} */ other
		for (const key of Object.keys(refObj)) {
			if (!Object.hasOwn(otherObj, key)) continue
			const child = path ? `${path}.${key}` : key
			issues.push(...scanLocaleTreeShape(refObj[key], otherObj[key], child))
		}
		return issues
	}

	if (refKind === 'array') {
		const refArr = /** @type {unknown[]} */ reference
		const otherArr = /** @type {unknown[]} */ other
		const n = Math.min(refArr.length, otherArr.length)
		for (let index = 0; index < n; index++)
			issues.push(...scanLocaleTreeShape(refArr[index], otherArr[index], `${path}[${index}]`))
	}

	return issues
}

/**
 * 对照参考 locale，扫描另一语言在共有路径上的 `${placeholder}` 集合不一致（翻译增删改占位符名）。
 * string ↔ switch 视为兼容：以 string 对照 switch 的 default；两侧 switch 再逐 case 比对。
 * @param {unknown} reference 参考树（通常 zh-CN）
 * @param {unknown} other 待检树
 * @param {string} [path=''] 当前点分路径
 * @returns {I18nKeyIssue[]} 占位符不匹配列表
 */
export function scanLocalePlaceholders(reference, other, path = '') {
	if (reference === undefined || other === undefined) return []
	const refKind = localeValueKind(reference)
	const otherKind = localeValueKind(other)

	if (refKind === 'string' && otherKind === 'string') {
		const refNames = extractPlaceholders(reference)
		const otherNames = extractPlaceholders(other)
		const missing = refNames.filter(name => !otherNames.includes(name))
		const extra = otherNames.filter(name => !refNames.includes(name))
		if (!missing.length && !extra.length) return []
		const detail = [
			missing.length ? `缺少 ${missing.join(', ')}` : '',
			extra.length ? `多出 ${extra.join(', ')}` : '',
		].filter(Boolean).join('；')
		return [{
			kind: 'placeholder_mismatch',
			path: path || '(root)',
			message: `占位符与参考不一致（${detail}）。翻译须原样保留占位符名，勿增删改。`,
		}]
	}

	if (refKind === 'switch' || otherKind === 'switch') {
		const refDefault = refKind === 'switch' ? reference.default : reference
		const otherDefault = otherKind === 'switch' ? other.default : other
		const issues = scanLocalePlaceholders(refDefault, otherDefault, path)
		if (refKind === 'switch' && otherKind === 'switch') {
			const refCases = reference.cases ?? {}
			const otherCases = other.cases ?? {}
			for (const key of Object.keys(refCases))
				if (Object.hasOwn(otherCases, key))
					issues.push(...scanLocalePlaceholders(refCases[key], otherCases[key], path ? `${path}.cases.${key}` : `cases.${key}`))
		}
		return issues
	}

	if (refKind === 'array' && otherKind === 'array') {
		const issues = []
		const n = Math.min(reference.length, other.length)
		for (let index = 0; index < n; index++)
			issues.push(...scanLocalePlaceholders(reference[index], other[index], `${path}[${index}]`))
		return issues
	}

	if (refKind === 'object' && otherKind === 'object') {
		const issues = []
		for (const key of Object.keys(reference))
			if (Object.hasOwn(other, key))
				issues.push(...scanLocalePlaceholders(reference[key], other[key], path ? `${path}.${key}` : key))
		return issues
	}

	return []
}

/**
 * 键集缺口扫描：`other` 相对 `reference` 缺了哪些键、多出哪些键。
 *
 * 叶子与结构（object / array）分别记账：整棵子树缺失时只报子树一次，不再逐叶刷屏。
 * switch 叶子是终端，其内部的 `default` / `cases` 不是键路径；叶子类型差异由
 * {@link scanLocaleTreeShape} 负责，这里只认「这个路径在不在」。
 * @param {unknown} reference 参考树（通常 zh-CN）
 * @param {unknown} other 待检树
 * @returns {{ missing: string[], extra: string[], missingNodes: string[], extraNodes: string[] }} 缺口
 */
export function localeKeyCoverage(reference, other) {
	/** @type {{ missing: string[], extra: string[], missingNodes: string[], extraNodes: string[] }} */
	const result = { missing: [], extra: [], missingNodes: [], extraNodes: [] }

	/**
	 * 节点是否为需要逐键比对的结构（switch 叶子算终端）。
	 * @param {unknown} value 节点
	 * @returns {boolean} 是否结构节点
	 */
	function isBranch(value) {
		if (Array.isArray(value)) return true
		if (value === null || typeof value !== 'object') return false
		return !isSwitchValue(value)
	}

	/**
	 * @param {unknown} reference 参考节点
	 * @param {unknown} other 待检节点
	 * @param {string} path 当前点分路径
	 * @returns {void}
	 */
	function walk(reference, other, path) {
		const refIsBranch = isBranch(reference)
		const otherIsBranch = isBranch(other)

		if (refIsBranch && otherIsBranch) {
			if (Array.isArray(reference) && Array.isArray(other)) {
				const n = Math.min(reference.length, other.length)
				for (let index = 0; index < n; index++) walk(reference[index], other[index], `${path}[${index}]`)
				for (let index = n; index < reference.length; index++) result.missingNodes.push(`${path}[${index}]`)
				for (let index = n; index < other.length; index++) result.extraNodes.push(`${path}[${index}]`)
				return
			}
			if (Array.isArray(reference) !== Array.isArray(other)) {
				// 一侧数组、一侧对象：结构层就对不上
				result[Array.isArray(reference) ? 'missingNodes' : 'extraNodes'].push(path)
				return
			}
			for (const key of Object.keys(reference)) {
				const child = path ? `${path}.${key}` : key
				if (!Object.hasOwn(other, key)) {
					result[isBranch(reference[key]) ? 'missingNodes' : 'missing'].push(child)
					continue
				}
				walk(reference[key], other[key], child)
			}
			for (const key of Object.keys(other))
				if (!Object.hasOwn(reference, key))
					result[isBranch(other[key]) ? 'extraNodes' : 'extra'].push(path ? `${path}.${key}` : key)
			return
		}

		if (refIsBranch !== otherIsBranch) {
			// 一侧结构、一侧叶子：根在结构层就对不上
			result[refIsBranch ? 'missingNodes' : 'extraNodes'].push(path)
			return
		}

		// 两侧都是叶子（叶子类型差异由 scanLocaleTreeShape 负责，这里只认路径在不在）
	}

	walk(reference, other, '')
	return result
}

/**
 * 对照参考 locale，扫描另一语言缺失 / 多出的键。
 *
 * 缺失的键在 locale bundle 里不存在（`getLocaleData` 只取一个 locale，没有逐键回退），
 * 取用时 `geti18n` 回落键名本身、`data-i18n` 元素留空，并把 `[i18n:missing]` 记为噪声。
 * @param {unknown} reference 参考树（通常 zh-CN）
 * @param {unknown} other 待检树
 * @returns {I18nKeyIssue[]} 键集问题
 */
export function scanLocaleKeyCoverage(reference, other) {
	const { missing, extra, missingNodes, extraNodes } = localeKeyCoverage(reference, other)
	/** @type {I18nKeyIssue[]} */
	const issues = []
	for (const path of missingNodes)
		issues.push({
			kind: 'missing_node',
			path,
			message: `缺少整个节点：参考语言有此处的子树，此处没有。遗漏的键在 bundle 里不存在，界面会回落键名 / 空白。补上该节点下 zh-CN 的全部键。${UPDATE_LOCALE_DATA_HINT}`,
		})
	for (const path of missing)
		issues.push({
			kind: 'missing_key',
			path,
			message: `缺少键：参考语言有此键，此处没有。缺失的键在 bundle 里不存在，界面会回落键名 / 空白。${UPDATE_LOCALE_DATA_HINT}`,
		})
	for (const path of extraNodes)
		issues.push({
			kind: 'extra_node',
			path,
			message: `多出节点：zh-CN 没有此处的子树（已删键的遗留或同步残渣）。确认它已废弃后删掉，否则下次同步会把它翻回来。${UPDATE_LOCALE_DATA_HINT}`,
		})
	for (const path of extra)
		issues.push({
			kind: 'extra_key',
			path,
			message: `多出键：zh-CN 没有此键（已删键的遗留或同步残渣）。确认它已废弃后删掉，否则下次同步会把它翻回来。${UPDATE_LOCALE_DATA_HINT}`,
		})
	return issues
}

/**
 * 扫描 emoji 语言里与 zh-CN 逐字相同的叶子：同步脚本给「没有 Google 目标码」的语言
 * 直接抄了源语言（`get_compatible_code('emoji')` 走复制分支），抄来的汉字既过不了
 * {@link scanEmojiLocaleForbiddenScript}，也说明这一条根本没被翻译。
 * @param {unknown} reference 参考树（通常 zh-CN）
 * @param {unknown} other emoji 树
 * @returns {I18nKeyIssue[]} 抄源问题
 */
export function scanEmojiLocaleCopiedSource(reference, other) {
	/** @type {I18nKeyIssue[]} */
	const issues = []

	/**
	 * @param {unknown} reference 参考节点
	 * @param {unknown} other 待检节点
	 * @param {string} path 当前点分路径
	 * @returns {void}
	 */
	function walk(reference, other, path) {
		if (isSwitchValue(reference) || isSwitchValue(other)) return
		const refIsBranch = reference !== null && typeof reference === 'object'
		const otherIsBranch = other !== null && typeof other === 'object'
		if (refIsBranch && otherIsBranch && !Array.isArray(reference) && !Array.isArray(other)) {
			for (const key of Object.keys(reference))
				if (Object.hasOwn(other, key)) walk(reference[key], other[key], path ? `${path}.${key}` : key)
			return
		}
		if (typeof reference !== 'string' || typeof other !== 'string') return
		if (!HAN_RE.test(reference) || reference !== other) return
		issues.push({
			kind: 'forbidden_script',
			path,
			message: `emoji 文案与 zh-CN 逐字相同（「${other}」）：同步脚本对没有 Google 目标码的语言直接抄源语言，这一条没被翻译。改成 emoji 说法。详见 locale-edits.md「Targets Google cannot translate」。`,
		})
	}

	walk(reference, other, '')
	return issues
}

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
		if (isSwitchValue(value)) continue
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
	while (true) {
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
