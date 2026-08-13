/**
 * wait/install 静态页模板 API。
 */
import { dialogsFor } from '../../scripts/features/dialog.mjs'
import { templatesFor } from '../../scripts/features/template.mjs'

/**
 * wait/install 页模板渲染 / 挂载 API。
 */
export const {
	renderTemplate,
	renderTemplateNoScriptActivation,
	renderTemplateAsHtmlString,
	mountTemplate,
	appendTemplate,
} = templatesFor('wait/install/templates')

/**
 * wait/install 页模板对话框 API。
 */
export const {
	openDialogFromTemplate,
	pushDialogFromTemplate,
	pickFromDialog,
	backDialog,
} = dialogsFor('wait/install/templates')
