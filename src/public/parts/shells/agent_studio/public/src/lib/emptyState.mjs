/**
 * 【文件】public/src/lib/emptyState.mjs — 空态挂载助手
 * 【职责】用 `empty_state` 模板构建带图标的空态节点，并挂载到容器。
 * 【原理】图标走 Iconify mask class；标题 / 提示走 i18n key，随语言切换。
 * 【关联】templates/empty_state.html、views/*。
 */
import { renderTemplate } from '../templates.mjs'

/**
 * 构建空态节点。
 * @param {object} options 选项
 * @param {string} options.titleKey i18n 标题键
 * @param {string} [options.iconClass] 图标 class（如 icon-robot）
 * @param {string} [options.hintKey] i18n 提示键
 * @param {string} [options.modClass] 修饰 class（含前导空格）
 * @returns {Promise<Element>} 空态节点
 */
export function buildEmptyState({ titleKey, iconClass = '', hintKey = '', modClass = '' }) {
	return renderTemplate('empty_state', {
		modClass,
		titleKey,
		iconHtml: iconClass
			? `<span class="empty-state-icon icon ${iconClass}" aria-hidden="true"></span>`
			: '',
		hintHtml: hintKey
			? `<p class="empty-state-hint" data-i18n="${hintKey}"></p>`
			: '',
	})
}

/**
 * 用空态替换容器内容。
 * @param {HTMLElement} container 容器
 * @param {Parameters<typeof buildEmptyState>[0]} options 选项
 * @returns {Promise<Element>} 空态节点
 */
export async function mountEmptyState(container, options) {
	const node = await buildEmptyState(options)
	container.replaceChildren(node)
	return node
}
