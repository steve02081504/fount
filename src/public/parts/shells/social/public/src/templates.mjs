/**
 * Social 壳模板 / 对话框 API（绑定 `/parts/shells:social/src/templates`）。
 */
import { dialogsFor } from '/scripts/features/dialog.mjs'
import { templatesFor } from '/scripts/features/template.mjs'

/**
 * Social 页模板渲染 / 挂载 API。
 */
export const {
	renderTemplate,
	renderTemplateNoScriptActivation,
	renderTemplateAsHtmlString,
	mountTemplate,
	appendTemplate,
} = templatesFor('/parts/shells:social/src/templates')

/**
 * Social 页模板对话框 API。
 */
export const {
	openDialogFromTemplate,
	pushDialogFromTemplate,
	pickFromDialog,
	backDialog,
} = dialogsFor('/parts/shells:social/src/templates')
