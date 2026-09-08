/**
 * 【职责】i18n innerHTML/textContent 覆盖前的子树白名单守卫。
 * 叶子字符串键（或 textContent/innerHTML applicator）会把元素子树整个替换；
 * 若子树含图标/控件类元素（svg/img/button/…），多为误用 data-i18n。
 * 白名单 = 基础文本类元素 ∪ locale 值中实际出现的标签（如行内格式化 i/em/strong——
 * 由 setI18nBundle 在 bundle 加载后注入，随 locale 内容自动扩展，无漂移义务），
 * 再剔除控件/嵌入类硬禁区（locale 值也不应生成这些做子树占位）。
 * 与 pages/scripts/i18n translateSingularElement 配套。
 */

/** 基础白名单：i18n 插值机制自身恒可生成的文本类元素。 */
const BASE_ALLOWED_I18N_CHILD_TAGS = new Set(['div', 'p', 'br', 'code', 'span', 'a'])

/** 硬禁区：图标 / 控件 / 嵌入类元素——locale 值中出现也不放行（子树含它们仍属误用）。 */
const HARD_BANNED_I18N_CHILD_TAGS = new Set([
	'svg', 'img', 'button', 'input', 'select', 'textarea', 'option',
	'video', 'audio', 'iframe', 'object', 'embed', 'canvas',
	'form', 'table', 'details', 'summary', 'dialog',
])

/** locale 值动态注入的标签集合（跨语言累计，幂等）。 */
const seededLocaleTags = new Set()

/** 从字符串值提取 HTML 开标签名的正则。 */
const HTML_TAG_RE = /<([a-zA-Z][\w-]*)/g

/**
 * 从 locale 字符串值提取可生成的标签并注入动态白名单（幂等；bundle 加载/切换后重复调用累计生效）。
 * @param {Iterable<unknown>} values - locale 值集合（深度遍历所得，非字符串跳过）。
 * @returns {void}
 */
export function seedAllowedTagsFromLocaleValues(values) {
	for (const value of values) {
		if (typeof value !== 'string') continue
		for (const match of value.matchAll(HTML_TAG_RE)) {
			const tag = match[1].toLowerCase()
			if (!HARD_BANNED_I18N_CHILD_TAGS.has(tag)) seededLocaleTags.add(tag)
		}
	}
}

/**
 * 当前生效的白名单（基础 ∪ locale 动态注入，剔除硬禁区）。
 * @returns {Set<string>} 白名单标签集合
 */
export function allowedI18nChildTags() {
	return new Set([...BASE_ALLOWED_I18N_CHILD_TAGS, ...seededLocaleTags].filter(tag => !HARD_BANNED_I18N_CHILD_TAGS.has(tag)))
}

/**
 * 找出子树中不在白名单内的元素标签（小写、去重、稳定序）。
 * @param {{ querySelectorAll: (selectors: string) => ArrayLike<{ tagName: string }> }} element 任意可查询子元素的对象（浏览器元素或测试 stub）
 * @returns {string[]} 违规标签列表；空数组 = 安全
 */
export function findDisallowedChildTags(element) {
	const allowed = allowedI18nChildTags()
	const seen = new Set()
	for (const node of element.querySelectorAll('*')) {
		const tag = node.tagName?.toLowerCase()
		if (tag && !allowed.has(tag)) seen.add(tag)
	}
	return [...seen]
}
