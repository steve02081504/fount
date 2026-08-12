/**
 * Deskpet 壳模板 API。
 */
import { templatesFor } from '/scripts/features/template.mjs'

const ROOT = '/parts/shells:deskpet/templates'

export const {
	renderTemplate,
	renderTemplateNoScriptActivation,
	renderTemplateAsHtmlString,
	mountTemplate,
	appendTemplate,
} = templatesFor(ROOT)
