/**
 * Social 壳模板 / 对话框 API（绑定 `/parts/shells:social/src/templates`）。
 */
import { dialogsFor } from '/scripts/features/dialog.mjs'
import { templatesFor } from '/scripts/features/template.mjs'

const ROOT = '/parts/shells:social/src/templates'

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
