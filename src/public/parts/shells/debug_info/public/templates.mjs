/**
 * DebugInfo 壳模板 API。
 */
import { templatesFor } from '/scripts/features/template.mjs'

const ROOT = '/parts/shells:debug_info/templates'

/**
 * DebugInfo 页模板渲染 / 挂载 API。
 */
export const {
	renderTemplate,
	renderTemplateNoScriptActivation,
	renderTemplateAsHtmlString,
	mountTemplate,
	appendTemplate,
} = templatesFor(ROOT)
