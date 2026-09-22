/**
 * home_registry.json 的 info 键健康检查。
 *
 * 主页功能菜单与接口按钮用 `geti18n(info).title` 渲染标题（home/public/src/ui.mjs、
 * ui/itemModal.mjs）；info 缺失或指向不存在的 locale 键时，菜单项只剩图标、标题为空。
 * 本检查确保每个 info 都能在每种权威语言中解析，且显示类条目解析为含非空 title 字符串的对象。
 */

/**
 * 权威语言集合：主页 info 键必须在这些语言中均可解析，避免某语言缺键时标题显示 undefined。
 */
export const AUTHORITATIVE_LOCALES = ['zh-CN', 'en-UK', 'ja-JP']

/**
 * 按点分路径解析 locale 树。
 * @param {unknown} locale locale 根（通常 zh-CN.json）
 * @param {unknown} key 点分键
 * @returns {unknown} 命中的值；任一段缺失时 undefined
 */
export function resolveLocaleKey(locale, key) {
	if (typeof key !== 'string' || !key) return undefined
	let node = locale
	for (const segment of key.split('.')) {
		if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined
		if (!Object.hasOwn(node, segment)) return undefined
		node = /** @type {Record<string, unknown>} */ node[segment]
	}
	return node
}

/**
 * 展平可能为数组或对象桶的条目集合。
 * @param {unknown} value 条目集合
 * @returns {unknown[]} 条目数组
 */
function toEntries(value) {
	if (Array.isArray(value)) return value
	if (value && typeof value === 'object') return Object.values(value)
	return []
}

/**
 * 递归展平 home_function_buttons（含 sub_items）。
 * @param {unknown} value 按钮集合
 * @param {unknown[]} out 收集数组
 * @returns {void}
 */
function collectButtons(value, out) {
	for (const item of toEntries(value)) {
		if (!item || typeof item !== 'object' || Array.isArray(item)) continue
		out.push(item)
		collectButtons(/** @type {Record<string, unknown>} */ item.sub_items, out)
	}
}

/**
 * 收集 home_registry 中所有待校验的 info 引用。
 * @param {unknown} data home_registry.json 根对象
 * @returns {{ info: unknown, requiresTitle: boolean, context: string }[]} info 引用列表
 */
export function collectHomeInfoRefs(data) {
	/** @type {{ info: unknown, requiresTitle: boolean, context: string }[]} */
	const refs = []
	if (!data || typeof data !== 'object' || Array.isArray(data)) return refs
	const root = /** @type {Record<string, unknown>} */ data

	const buttons = []
	collectButtons(root.home_function_buttons, buttons)
	for (const item of buttons)
		refs.push({ info: /** @type {Record<string, unknown>} */ item.info, requiresTitle: true, context: 'home_function_buttons' })

	const interfaces = root.home_interfaces
	if (interfaces && typeof interfaces === 'object' && !Array.isArray(interfaces))
		for (const [key, list] of Object.entries(interfaces))
			for (const item of toEntries(list)) {
				if (!item || typeof item !== 'object' || Array.isArray(item)) continue
				refs.push({ info: /** @type {Record<string, unknown>} */ item.info, requiresTitle: true, context: `home_interfaces.${key}` })
			}

	for (const type of /** @type {const} */['home_drag_in_handlers', 'home_drag_out_generators'])
		for (const item of toEntries(root[type])) {
			if (!item || typeof item !== 'object' || Array.isArray(item)) continue
			refs.push({ info: /** @type {Record<string, unknown>} */ item.info, requiresTitle: false, context: type })
		}

	return refs
}

/**
 * 扫描单个 home_registry.json 的 info 引用问题。
 * @param {string} relPath 相对仓库根的路径
 * @param {unknown} data home_registry.json 根对象
 * @param {unknown} locale locale 根
 * @param {string} localeName 语言 id（用于问题文案）
 * @returns {{ path: string, message: string }[]} 问题列表
 */
export function scanHomeRegistryData(relPath, data, locale, localeName) {
	/** @type {{ path: string, message: string }[]} */
	const issues = []
	for (const { info, requiresTitle, context } of collectHomeInfoRefs(data)) {
		if (typeof info !== 'string' || !info) {
			issues.push({ path: relPath, message: `${context} 条目缺少 info locale 键` })
			continue
		}
		const value = resolveLocaleKey(locale, info)
		if (value === undefined) {
			issues.push({ path: relPath, message: `${context} 的 info 键不存在于 ${localeName}: ${info}` })
			continue
		}
		if (!requiresTitle) continue
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			issues.push({ path: relPath, message: `${context} 的 info 须指向含 title 的对象: ${info}` })
			continue
		}
		const title = /** @type {Record<string, unknown>} */ value.title
		if (typeof title !== 'string' || !title.trim())
			issues.push({ path: relPath, message: `${context} 的 info.title 缺失或非字符串: ${info}` })
	}
	return issues
}
