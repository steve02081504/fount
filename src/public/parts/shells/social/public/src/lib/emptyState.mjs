import { renderTemplate } from '/scripts/features/template.mjs'

/**
 * 构建带图标的空态节点。
 * @param {object} options 选项
 * @param {string} options.titleKey i18n 标题键
 * @param {string} [options.iconClass] 图标 class（如 icon-bookmark）
 * @param {string} [options.hintKey] i18n 提示键
 * @param {string} [options.modClass] 修饰 class（含前导空格，如 ` empty-state--saved`）
 * @param {string} [options.actionHtml] 底部操作 HTML
 * @returns {Promise<HTMLElement>} 空态节点
 */
export async function buildEmptyState({ titleKey, iconClass = '', hintKey = '', modClass = '', actionHtml = '' }) {
	return renderTemplate('empty_state', {
		modClass,
		titleKey,
		iconHtml: iconClass
			? `<span class="icon ${iconClass} empty-state-icon" aria-hidden="true"></span>`
			: '',
		hintHtml: hintKey
			? `<p class="empty-state-hint" data-i18n="${hintKey}"></p>`
			: '',
		actionHtml,
	})
}
