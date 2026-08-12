/**
 * Cabinet 壳模板 API（绑定 `/parts/shells:cabinet/src/templates`）。
 */
import { templatesFor } from '/scripts/features/template.mjs'

const ROOT = '/parts/shells:cabinet/src/templates'

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
