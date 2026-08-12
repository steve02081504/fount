/**
 * LanguageSettings 壳模板 API。
 */
import { templatesFor } from '/scripts/features/template.mjs'

/**
 * LanguageSettings 页模板渲染 / 挂载 API。
 */
export const {
	renderTemplate,
	renderTemplateNoScriptActivation,
	renderTemplateAsHtmlString,
	mountTemplate,
	appendTemplate,
} = templatesFor('/parts/shells:languageSettings/templates')
