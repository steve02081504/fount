/**
 * BrowserIntegration 壳模板 API。
 */
import { templatesFor } from '/scripts/features/template.mjs'

/**
 * BrowserIntegration 页模板渲染 / 挂载 API。
 */
export const {
	renderTemplate,
	renderTemplateNoScriptActivation,
	renderTemplateAsHtmlString,
	mountTemplate,
	appendTemplate,
} = templatesFor('/parts/shells:browserIntegration/templates')
