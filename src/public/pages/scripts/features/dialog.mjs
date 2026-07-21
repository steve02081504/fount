/**
 * 通用 `<dialog class="modal">` 生命周期：创建、模板渲染、showModal、关闭销毁。
 *
 * 模板应只含 `modal-box` + 可选 `modal-backdrop`，不要再包一层 `<dialog>`——
 * 本模块会创建托管 dialog；若模板根仍是 dialog，会解包子节点，避免嵌套 modal 锁死页面。
 */
import { renderTemplate, renderTemplateNoScriptActivation } from './template.mjs'

/** @type {WeakMap<HTMLDialogElement, Array<{ content: DocumentFragment | null }>>} */
const dialogNavigationStacks = new WeakMap()

/**
 * @param {HTMLDialogElement} dialog 托管 dialog
 * @param {Element | DocumentFragment | Document} node 模板渲染结果
 * @returns {void}
 */
function appendTemplateContent(dialog, node) {
	if (node instanceof HTMLDialogElement) {
		dialog.append(...node.childNodes)
		return
	}
	dialog.appendChild(node)
}

/**
 * 将当前页收起并渲染新的对话框页；`[data-dialog-back]` 会恢复原 DOM 与表单状态。
 * @param {HTMLDialogElement} dialog 对话框
 * @param {string} templateName 模板路径（相对 usingTemplates 根）
 * @param {object} [data={}] 模板数据
 * @param {{
 *   onReady?: (dialog: HTMLDialogElement) => void | Promise<void>
 *   activateScripts?: boolean
 * }} [options] 对话框页选项
 * @returns {Promise<HTMLDialogElement>} 对话框
 */
export async function pushDialogFromTemplate(dialog, templateName, data = {}, options = {}) {
	const stack = dialogNavigationStacks.get(dialog)
	if (!stack) throw new Error('Dialog is not managed by openDialogFromTemplate')

	const previousPage = stack.at(-1)
	const content = document.createDocumentFragment()
	content.append(...dialog.childNodes)
	previousPage.content = content

	appendTemplateContent(dialog, await (options.activateScripts === false ? renderTemplateNoScriptActivation : renderTemplate)(templateName, data))
	stack.push({ content: null })
	if (options.onReady) await options.onReady(dialog)
	dialog.querySelector('[autofocus]')?.focus()
	return dialog
}

/**
 * 返回上一对话框页；根页调用等同关闭。
 * @param {HTMLDialogElement} dialog 对话框
 * @returns {void}
 */
export function backDialog(dialog) {
	const stack = dialogNavigationStacks.get(dialog)
	if (!stack || stack.length <= 1) {
		dialog.close()
		return
	}
	dialog.replaceChildren()
	stack.pop()
	const previousPage = stack.at(-1)
	dialog.appendChild(previousPage.content)
	previousPage.content = null
	dialog.querySelector('[autofocus]')?.focus()
}

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
	appendTemplateContent(dialog, await (options.activateScripts === false ? renderTemplateNoScriptActivation : renderTemplate)(templateName, data))
	dialogNavigationStacks.set(dialog, [{ content: null }])
	dialog.addEventListener('click', event => {
		if (event.target.closest('[data-dialog-back]')) backDialog(dialog)
	})
	document.body.appendChild(dialog)
	if (options.onReady) await options.onReady(dialog)
	dialog.showModal()
	dialog.addEventListener('close', () => {
		dialogNavigationStacks.delete(dialog)
		dialog.remove()
	}, { once: true })
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
			/** @param {HTMLDialogElement} dialogElement 对话框 */
			onReady: dialogElement => {
				let settled = false
				/** @param {unknown} value 用户选择结果 */
				const finish = value => {
					if (settled) return
					settled = true
					if (dialogElement.open) dialogElement.close()
					resolve(value)
				}
				dialogElement.addEventListener('cancel', () => finish(null), { once: true })
				dialogElement.addEventListener('close', () => finish(null), { once: true })
				for (const sel of cancelSelectors)
					dialogElement.querySelector(sel)?.addEventListener('click', () => finish(null), { once: true })
				for (const button of dialogElement.querySelectorAll(resolveOn))
					button.addEventListener('click', () => {
						finish(options.mapResult
							? options.mapResult(dialogElement, button.getAttribute('data-dialog-resolve')
								|| button.getAttribute('data-action')
								|| 'ok')
							: button.getAttribute('data-dialog-resolve')
								|| button.getAttribute('data-action')
								|| 'ok')
					}, { once: true })
			},
		}).catch(reject)
	})
}
