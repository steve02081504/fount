import { pickFromDialog } from '/scripts/features/dialog.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

const CANCEL_OK = `
		<button type="button" class="btn" data-dialog-cancel data-i18n="social.saved.cancel"></button>
		<button type="button" class="btn btn-primary" data-dialog-resolve="ok" data-i18n="social.saved.confirm"></button>`
const OK_ONLY = `
		<button type="button" class="btn btn-primary" data-dialog-resolve="ok" data-i18n="social.saved.confirm"></button>`

/**
 * @param {string} title 对话框标题
 * @param {string} [value=''] 初始输入
 * @returns {Promise<string | null>} 用户输入；取消为 null
 */
export function promptText(title, value = '') {
	return pickFromDialog('text_prompt_modal', {
		title,
		boxClass: '',
		bodyHtml: `<input type="text" class="input input-bordered w-full" id="promptInput" value="${escapeHtml(value)}" />`,
		actionsHtml: CANCEL_OK,
	}, {
		/**
		 * @param {HTMLDialogElement} dialog 对话框元素
		 * @returns {string | null} 用户输入（可为空表示清除）；取消为 null
		 */
		mapResult: dialog => {
			const input = dialog.querySelector('#promptInput')
			return input instanceof HTMLInputElement ? input.value.trim() : null
		},
	})
}

/**
 * 多行文本输入（读者补充等）。
 * @param {string} title 标题
 * @param {string} [value=''] 初始值
 * @returns {Promise<string | null>} 输入或取消
 */
export function promptTextArea(title, value = '') {
	return pickFromDialog('text_prompt_modal', {
		title,
		boxClass: '',
		bodyHtml: `<textarea class="textarea textarea-bordered w-full min-h-32" id="promptInput" maxlength="2000" rows="6">${escapeHtml(value)}</textarea>`,
		actionsHtml: CANCEL_OK,
	}, {
		/**
		 * @param {HTMLDialogElement} dialog 对话框
		 * @returns {string | null} 输入
		 */
		mapResult: dialog => dialog.querySelector('#promptInput')?.value.trim() || null,
	})
}

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

/**
 * @param {string} message 确认文案
 * @returns {Promise<boolean>} 用户确认
 */
export async function confirmAction(message) {
	return await pickFromDialog('confirm_modal', { message }) === 'ok'
}
