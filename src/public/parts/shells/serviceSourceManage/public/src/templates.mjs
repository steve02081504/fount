/**
 * ServiceSourceManage 壳模板 API。
 */
import { templatesFor } from '/scripts/features/template.mjs'

/**
 * ServiceSourceManage 页模板渲染 / 挂载 API。
 */
export const {
	renderTemplate,
	renderTemplateNoScriptActivation,
	renderTemplateAsHtmlString,
	mountTemplate,
	appendTemplate,
} = templatesFor('/parts/shells:serviceSourceManage/src/templates')
