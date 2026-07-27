/**
 * 共享 DaisyUI 文本输入 / 确认对话框（替代 window.prompt / window.confirm）。
 */
import { escapeHtml } from '../lib/escapeHtml.mjs'

import { pickFromDialog } from './dialog.mjs'
import { withTemplates } from './template.mjs'

const TEMPLATES = '/scripts/features/templates'

const CANCEL_OK = `
		<button type="button" class="btn" data-dialog-cancel data-i18n="util.common.cancel"></button>
		<button type="button" class="btn btn-primary" data-dialog-resolve="ok" data-i18n="util.common.confirm"></button>`

/**
 * @template T
 * @param {() => Promise<T>} fn 在共享模板根下执行
 * @returns {Promise<T>} 回调结果
 */
function withSharedTemplates(fn) {
	return withTemplates(TEMPLATES, fn)
}

/**
 * @param {string} title 对话框标题
 * @param {string} [value=''] 初始输入
 * @returns {Promise<string | null>} 用户输入；取消为 null
 */
export function promptText(title, value = '') {
	return withSharedTemplates(() => pickFromDialog('text_prompt_modal', {
		title,
		boxClass: '',
		bodyHtml: `<input type="text" class="input input-bordered w-full" id="promptInput" aria-label="${escapeHtml(title)}" value="${escapeHtml(value)}" autofocus />`,
		actionsHtml: CANCEL_OK,
	}, {
		/**
		 * @param {HTMLDialogElement} dialog 对话框
		 * @returns {string | null} 输入值或 null
		 */
		mapResult: dialog => {
			const input = dialog.querySelector('#promptInput')
			return input instanceof HTMLInputElement ? input.value.trim() : null
		},
	}))
}

/**
 * @param {string} title 标题
 * @param {string} [value=''] 初始值
 * @returns {Promise<string | null>} 输入或取消
 */
export function promptTextArea(title, value = '') {
	return withSharedTemplates(() => pickFromDialog('text_prompt_modal', {
		title,
		boxClass: '',
		bodyHtml: `<textarea class="textarea textarea-bordered w-full min-h-32" id="promptInput" aria-label="${escapeHtml(title)}" maxlength="2000" rows="6" autofocus>${escapeHtml(value)}</textarea>`,
		actionsHtml: CANCEL_OK,
	}, {
		/**
		 * @param {HTMLDialogElement} dialog 对话框
		 * @returns {string | null} 文本或 null
		 */
		mapResult: dialog => {
			const input = dialog.querySelector('#promptInput')
			return input instanceof HTMLTextAreaElement ? input.value.trim() : null
		},
	}))
}

/**
 * @param {string} message 确认文案
 * @returns {Promise<boolean>} 用户确认
 */
export async function confirmAction(message) {
	return await withSharedTemplates(() => pickFromDialog('confirm_modal', { message })) === 'ok'
}
