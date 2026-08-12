/**
 * 共享 DaisyUI 对话框模板根（prompt / confirm）。
 */
import { dialogsFor } from './dialog.mjs'
import { templatesFor } from './template.mjs'

/**
 * 共享对话框模板渲染 / 挂载 API。
 */
export const {
	renderTemplate,
	renderTemplateNoScriptActivation,
	renderTemplateAsHtmlString,
	mountTemplate,
	appendTemplate,
} = templatesFor('/scripts/features/templates')

/**
 * 共享对话框模板对话框 API。
 */
export const {
	openDialogFromTemplate,
	pushDialogFromTemplate,
	pickFromDialog,
	backDialog,
} = dialogsFor('/scripts/features/templates')
