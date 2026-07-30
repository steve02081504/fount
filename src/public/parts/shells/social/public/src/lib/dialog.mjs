/**
 * Social 对话框包装 — 委托共享 DaisyUI prompt/confirm。
 */
export { promptText, promptTextArea, confirmAction } from '/scripts/features/promptDialog.mjs'
import { pickFromDialog } from '/scripts/features/dialog.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

const OK_ONLY = `
		<button type="button" class="btn btn-primary" data-dialog-resolve="ok" data-i18n="util.common.confirm"></button>`

/**
 * @param {string} text 只读正文（动态内容，挂 user-content）
 * @param {string} titleI18nKey 标题 i18n 键
 * @returns {Promise<void>}
 */
export function showText(text, titleI18nKey) {
	const key = String(titleI18nKey || '').trim()
	if (!key) throw new Error('showText requires title i18n key')
	return pickFromDialog('text_prompt_modal', {
		titleI18n: key,
		titleParamsAttrs: '',
		boxClass: ' max-w-lg',
		bodyHtml: `<pre class="whitespace-pre-wrap text-sm max-h-96 overflow-auto" user-content>${escapeHtml(text)}</pre>`,
		actionsHtml: OK_ONLY,
	})
}
