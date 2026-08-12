/**
 * 通用 `<dialog class="modal">` 生命周期：创建、模板渲染、showModal、关闭销毁。
 *
 * 模板应只含 `modal-box` + 可选 `modal-backdrop`，不要再包一层 `<dialog>`——
 * 本模块会创建托管 dialog；若模板根仍是 dialog，会解包子节点，避免嵌套 modal 锁死页面。
 *
 * 用 `dialogsFor(root)` 绑定模板根；勿依赖全局路径。
 */
import { templatesFor } from './template.mjs'

/** @type {WeakMap<HTMLDialogElement, Array<{ content: DocumentFragment | null }>>} */
const dialogNavigationStacks = new WeakMap()

/** @type {Map<string, ReturnType<typeof createDialogsApi>>} */
const dialogsByRoot = new Map()

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
 * @param {ReturnType<typeof templatesFor>} templates 绑定模板 API
 * @returns {{
 *   pushDialogFromTemplate: (dialog: HTMLDialogElement, templateName: string, data?: object, options?: object) => Promise<HTMLDialogElement>,
 *   openDialogFromTemplate: (templateName: string, data?: object, options?: object) => Promise<HTMLDialogElement>,
 *   pickFromDialog: (templateName: string, data?: object, options?: object) => Promise<unknown>,
 *   backDialog: typeof backDialog,
 * }} 绑定对话框 API
 */
function createDialogsApi(templates) {
	const { renderTemplate, renderTemplateNoScriptActivation } = templates

	/**
	 * 将当前页收起并渲染新的对话框页；`[data-dialog-back]` 会恢复原 DOM 与表单状态。
	 * @param {HTMLDialogElement} dialog 对话框
	 * @param {string} templateName 模板路径（相对 templates 根）
	 * @param {object} [data={}] 模板数据
	 * @param {{
	 *   onReady?: (dialog: HTMLDialogElement) => void | Promise<void>
	 *   activateScripts?: boolean
	 * }} [options] 对话框页选项
	 * @returns {Promise<HTMLDialogElement>} 对话框
	 */
	async function pushDialogFromTemplate(dialog, templateName, data = {}, options = {}) {
		const stack = dialogNavigationStacks.get(dialog)
		if (!stack) throw new Error('Dialog is not managed by openDialogFromTemplate')

		const previousPage = stack.at(-1)
		const content = document.createDocumentFragment()
		content.append(...dialog.childNodes)
		previousPage.content = content

		const render = options.activateScripts === false ? renderTemplateNoScriptActivation : renderTemplate
		appendTemplateContent(dialog, await render(templateName, data))
		stack.push({ content: null })
		if (options.onReady) await options.onReady(dialog)
		dialog.querySelector('[autofocus]')?.focus()
		return dialog
	}

	/**
	 * @param {string} templateName 模板路径（相对 templates 根）
	 * @param {object} [data={}] 模板数据
	 * @param {{
	 *   onReady?: (dialog: HTMLDialogElement) => void | Promise<void>
	 *   className?: string
	 *   activateScripts?: boolean
	 * }} [options] 对话框选项；`activateScripts: false` 用于含表单的模态
	 * @returns {Promise<HTMLDialogElement>} 已打开的 dialog 元素
	 */
	async function openDialogFromTemplate(templateName, data = {}, options = {}) {
		const dialog = document.createElement('dialog')
		dialog.className = options.className ?? 'modal'
		const render = options.activateScripts === false ? renderTemplateNoScriptActivation : renderTemplate
		appendTemplateContent(dialog, await render(templateName, data))
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
	function pickFromDialog(templateName, data = {}, options = {}) {
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

	return {
		pushDialogFromTemplate,
		openDialogFromTemplate,
		pickFromDialog,
		backDialog,
	}
}

/**
 * 绑定到指定模板根的对话框 API（按根记忆化）。
 * @param {string} path 模板根（同 templatesFor）
 * @returns {ReturnType<typeof createDialogsApi>} 绑定 API
 */
export function dialogsFor(path) {
	const resolved = path
	let api = dialogsByRoot.get(resolved)
	if (!api) {
		api = createDialogsApi(templatesFor(path))
		dialogsByRoot.set(resolved, api)
	}
	return api
}
