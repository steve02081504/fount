import { pickFromDialog } from '/scripts/features/dialog.mjs'

/**
 * @param {string} title 对话框标题
 * @param {string} [value=''] 初始输入
 * @returns {Promise<string | null>} 用户输入；取消为 null
 */
export function promptText(title, value = '') {
	return pickFromDialog('text_prompt_modal', { title, value }, {
		/**
		 * @param {HTMLDialogElement} dialog 对话框元素
		 * @returns {string | null} 用户输入；取消为 null
		 */
		mapResult: dialog => dialog.querySelector('#promptInput')?.value.trim() || null,
	})
}

/**
 * 多行文本输入（读者补充等）。
 * @param {string} title 标题
 * @param {string} [value=''] 初始值
 * @returns {Promise<string | null>} 输入或取消
 */
export function promptTextArea(title, value = '') {
	return pickFromDialog('text_area_prompt_modal', { title, value }, {
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
	return pickFromDialog('text_view_modal', { text, title })
}

/**
 * @param {string} message 确认文案
 * @returns {Promise<boolean>} 用户确认
 */
export async function confirmAction(message) {
	return await pickFromDialog('confirm_modal', { message }) === 'ok'
}
