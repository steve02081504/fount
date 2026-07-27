/**
 * Social 对话框包装 — 委托共享 DaisyUI prompt/confirm。
 * 保留本地 text_prompt_modal / confirm_modal 模板路径的兼容 API。
 */
export { promptText, promptTextArea, confirmAction } from '/scripts/features/promptDialog.mjs'
import { pickFromDialog } from '/scripts/features/dialog.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

const OK_ONLY = `
		<button type="button" class="btn btn-primary" data-dialog-resolve="ok" data-i18n="util.common.confirm"></button>`

/**
 * @param {string} text 只读正文
 * @param {string} [title=''] 标题
 * @returns {Promise<void>}
 */
export function showText(text, title = '') {
	return pickFromDialog('text_prompt_modal', {
		title,
		boxClass: ' max-w-lg',
		bodyHtml: `<pre class="whitespace-pre-wrap text-sm max-h-96 overflow-auto">${escapeHtml(text)}</pre>`,
		actionsHtml: OK_ONLY,
	})
}
