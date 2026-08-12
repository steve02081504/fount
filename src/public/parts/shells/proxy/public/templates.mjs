/**
 * Proxy 壳模板 API。
 */
import { templatesFor } from '/scripts/features/template.mjs'

export const {
	renderTemplate,
	renderTemplateNoScriptActivation,
	renderTemplateAsHtmlString,
	mountTemplate,
	appendTemplate,
} = templatesFor('/parts/shells:proxy/templates')
