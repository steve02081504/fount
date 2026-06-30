/**
 * 通用 `<dialog class="modal">` 生命周期：创建、模板渲染、showModal、关闭销毁。
 */
import { renderTemplate, renderTemplateNoScriptActivation } from './template.mjs'

/**
 * @param {string} templateName 模板路径（相对 usingTemplates 根）
 * @param {object} [data={}] 模板数据
 * @param {{
 *   onReady?: (dialog: HTMLDialogElement) => void | Promise<void>
 *   className?: string
 *   activateScripts?: boolean
 * }} [options] 对话框选项；`activateScripts: false` 用于含表单的模态
 * @returns {Promise<HTMLDialogElement>} 已打开的 dialog 元素
 */
export async function openDialogFromTemplate(templateName, data = {}, options = {}) {
	const dialog = document.createElement('dialog')
	dialog.className = options.className ?? 'modal'
	dialog.appendChild(await (options.activateScripts === false ? renderTemplateNoScriptActivation : renderTemplate)(templateName, data))
	document.body.appendChild(dialog)
	if (options.onReady) await options.onReady(dialog)
	dialog.showModal()
	dialog.addEventListener('close', () => dialog.remove(), { once: true })
	return dialog
}

/**
 * @param {string} templateName 模板名
 * @param {object} [data={}] 模板数据
 * @param {{
 *   resolveOn?: string
 *   cancelOn?: string | string[]
 *   mapResult?: (dialog: HTMLDialogElement, action: string) => unknown
 * }} [options] 选择器与结果映射
 * @returns {Promise<unknown>} 用户选择结果；取消为 null
 */
export function pickFromDialog(templateName, data = {}, options = {}) {
	const resolveOn = options.resolveOn ?? '[data-dialog-resolve]'
	const cancelSelectors = Array.isArray(options.cancelOn)
		? options.cancelOn
		: [options.cancelOn ?? '[data-dialog-cancel]', '[data-action="cancel"]']

	return new Promise((resolve, reject) => {
		openDialogFromTemplate(templateName, data, {
			/** @param {HTMLDialogElement} dialogEl 对话框 */
			onReady: dialogEl => {
				/** @param {unknown} value 用户选择结果 */
				const finish = value => {
					dialogEl.close()
					resolve(value)
				}
				dialogEl.addEventListener('cancel', () => finish(null), { once: true })
				for (const sel of cancelSelectors)
					dialogEl.querySelector(sel)?.addEventListener('click', () => finish(null), { once: true })
				for (const btn of dialogEl.querySelectorAll(resolveOn))
					btn.addEventListener('click', () => {
						finish(options.mapResult
							? options.mapResult(dialogEl, btn.getAttribute('data-dialog-resolve')
								|| btn.getAttribute('data-action')
								|| 'ok')
							: btn.getAttribute('data-dialog-resolve')
								|| btn.getAttribute('data-action')
								|| 'ok')
					}, { once: true })
			},
		}).catch(reject)
	})
}
