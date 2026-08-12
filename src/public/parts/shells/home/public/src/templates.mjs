/**
 * Home 壳模板 API（绑定 `/parts/shells:home/src/templates`）。
 */
import { templatesFor } from '/scripts/features/template.mjs'

const ROOT = '/parts/shells:home/src/templates'

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
