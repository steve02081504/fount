/**
 * Cabinet 壳模板 API（绑定 `/parts/shells:cabinet/src/templates`）。
 */
import { templatesFor } from '/scripts/features/template.mjs'

/**
 * Cabinet 页模板渲染 / 挂载 API。
 */
export const {
	renderTemplate,
	renderTemplateNoScriptActivation,
	renderTemplateAsHtmlString,
	mountTemplate,
	appendTemplate,
} = templatesFor('/parts/shells:cabinet/src/templates')
