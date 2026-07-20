import { openDialogFromTemplate } from '/scripts/features/dialog.mjs'
import { withTemplates } from '/scripts/features/template.mjs'

const CHAT_TEMPLATES = '/parts/shells:chat/src/templates'

/**
 * 页内单行文本输入（替代 `window.prompt`，避免被资料弹层遮挡或环境吞掉原生 prompt）。
 * 确认返回 trim 后的字符串（可为空，表示清除）；取消返回 `null`。
 * @param {string} title 标题
 * @param {string} [value=''] 初始值
 * @returns {Promise<string | null>} 输入或取消
 */
export function promptText(title, value = '') {
	return withTemplates(CHAT_TEMPLATES, () => new Promise((resolve, reject) => {
		openDialogFromTemplate('hub/modals/text_prompt', { title, value }, {
			/**
			 * @param {HTMLDialogElement} dialog 对话框
			 * @returns {void}
			 */
			onReady: dialog => {
				const input = dialog.querySelector('#promptInput')
				let settled = false
				/**
				 * @param {string | null} result 结果
				 * @returns {void}
				 */
				const finish = result => {
					if (settled) return
					settled = true
					resolve(result)
					if (dialog.open) dialog.close()
				}
				dialog.addEventListener('close', () => {
					if (!settled) {
						settled = true
						resolve(null)
					}
				}, { once: true })
				dialog.querySelector('[data-dialog-cancel]')?.addEventListener('click', () => finish(null), { once: true })
				/**
				 * @returns {void}
				 */
				const confirm = () => {
					finish(input instanceof HTMLInputElement ? input.value.trim() : '')
				}
				dialog.querySelector('[data-dialog-resolve]')?.addEventListener('click', confirm, { once: true })
				if (input instanceof HTMLInputElement)
					input.addEventListener('keydown', event => {
						if (event.key === 'Enter') {
							event.preventDefault()
							confirm()
						}
					})
			},
		}).catch(reject)
	}))
}
