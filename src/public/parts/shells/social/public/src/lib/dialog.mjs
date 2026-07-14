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
 * @param {string} message 确认文案
 * @returns {Promise<boolean>} 用户确认
 */
export async function confirmAction(message) {
	return await pickFromDialog('confirm_modal', { message }) === 'ok'
}
