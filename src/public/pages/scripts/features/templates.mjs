/**
 * 共享 DaisyUI 对话框模板根（prompt / confirm）。
 */
import { dialogsFor } from './dialog.mjs'
import { templatesFor } from './template.mjs'

const ROOT = '/scripts/features/templates'

/**
 *
 */
export const {
	renderTemplate,
	renderTemplateNoScriptActivation,
	renderTemplateAsHtmlString,
	mountTemplate,
	appendTemplate,
} = templatesFor(ROOT)

/**
 *
 */
export const {
	openDialogFromTemplate,
	pushDialogFromTemplate,
	pickFromDialog,
	backDialog,
} = dialogsFor(ROOT)
