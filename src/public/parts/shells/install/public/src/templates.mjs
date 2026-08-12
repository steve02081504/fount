/**
 * Install 壳模板 API（绑定 `/parts/shells:install/src/templates`）。
 */
import { templatesFor } from '/scripts/features/template.mjs'

const ROOT = '/parts/shells:install/src/templates'

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
