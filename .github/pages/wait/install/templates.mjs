/**
 * wait/install 静态页模板 API。
 */
import { dialogsFor } from '../../scripts/features/dialog.mjs'
import { templatesFor } from '../../scripts/features/template.mjs'

const ROOT = 'wait/install/templates'

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
