/**
 * 共享 DaisyUI 文本输入 / 确认对话框（替代 window.prompt / window.confirm）。
 * 标题 / 确认文案一律走 i18n key（data-i18n），随语言轮换；勿传入已翻译字符串。
 */
import { escapeHtml } from '../lib/escapeHtml.mjs'

import { pickFromDialog } from './templates.mjs'

const CANCEL_OK = `
		<button type="button" class="btn" data-dialog-cancel data-i18n="util.common.cancel"></button>
		<button type="button" class="btn btn-primary" data-dialog-resolve="ok" data-i18n="util.common.confirm"></button>`

/**
 * @param {Record<string, string | number>} [params] i18n 插值（写入 data-*）
 * @returns {string} 属性串
 */
function i18nParamAttrs(params = {}) {
	return Object.entries(params)
		.map(([key, value]) => ` data-${escapeHtml(key)}="${escapeHtml(String(value))}"`)
		.join('')
}

/**
 * @param {string} i18nKey 标题 i18n 键
 * @param {string} [value=''] 初始输入
 * @param {Record<string, string | number>} [params] 标题插值
 * @returns {Promise<string | null>} 用户输入；取消为 null
 */
export function promptText(i18nKey, value = '', params = {}) {
	const key = i18nKey.trim()
	if (!key) throw new Error('promptText requires i18n key')
	return pickFromDialog('text_prompt_modal', {
		titleI18n: key,
		titleParamsAttrs: i18nParamAttrs(params),
		boxClass: '',
		bodyHtml: `<input type="text" class="input input-bordered w-full" id="promptInput" aria-labelledby="promptDialogTitle" value="${escapeHtml(value)}" autofocus user-content />`,
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
	})
}

/**
 * @param {string} i18nKey 标题 i18n 键
 * @param {string} [value=''] 初始值
 * @param {Record<string, string | number>} [params] 标题插值
 * @returns {Promise<string | null>} 输入或取消
 */
export function promptTextArea(i18nKey, value = '', params = {}) {
	const key = i18nKey.trim()
	if (!key) throw new Error('promptTextArea requires i18n key')
	return pickFromDialog('text_prompt_modal', {
		titleI18n: key,
		titleParamsAttrs: i18nParamAttrs(params),
		boxClass: '',
		bodyHtml: `<textarea class="textarea textarea-bordered w-full min-h-32" id="promptInput" aria-labelledby="promptDialogTitle" maxlength="2000" rows="6" autofocus user-content>${escapeHtml(value)}</textarea>`,
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
	})
}

/**
 * @param {string} i18nKey 确认文案 i18n 键
 * @param {Record<string, string | number>} [params] 插值
 * @returns {Promise<boolean>} 用户确认
 */
export async function confirmAction(i18nKey, params = {}) {
	const key = i18nKey.trim()
	if (!key) throw new Error('confirmAction requires i18n key')
	return await pickFromDialog('confirm_modal', {
		messageI18n: key,
		messageParamsAttrs: i18nParamAttrs(params),
	}) === 'ok'
}
