/**
 * 【职责】i18n innerHTML/textContent 覆盖前的子树白名单守卫。
 * 叶子字符串键（或 textContent/innerHTML applicator）会把元素子树整个替换；
 * 若子树含图标/控件类元素（svg/img/button/…），多为误用 data-i18n。
 * 白名单限 i18n 自身能生成的文本类元素（div/p/br/code/span + 插值链接 a），
 * 其余一律告警（仅告警不阻断）。与 pages/scripts/i18n translateSingularElement 配套。
 */

/** 允许出现在 data-i18n 覆盖目标子树里的元素标签（小写）。 */
export const ALLOWED_I18N_CHILD_TAGS = new Set(['div', 'p', 'br', 'code', 'span', 'a'])

/**
 * 找出子树中不在白名单内的元素标签（小写、去重、稳定序）。
 * @param {{ querySelectorAll: (selectors: string) => ArrayLike<{ tagName: string }> }} element 任意可查询子元素的对象（浏览器元素或测试 stub）
 * @returns {string[]} 违规标签列表；空数组 = 安全
 */
export function findDisallowedChildTags(element) {
	const seen = new Set()
	for (const node of element.querySelectorAll('*')) {
		const tag = node.tagName?.toLowerCase()
		if (tag && !ALLOWED_I18N_CHILD_TAGS.has(tag)) seen.add(tag)
	}
	return [...seen]
}
