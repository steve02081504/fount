/**
 * ThemeManage 壳模板 API。
 */
import { templatesFor } from '/scripts/features/template.mjs'

/**
 * ThemeManage 页模板渲染 / 挂载 API。
 */
export const {
	renderTemplate,
	renderTemplateNoScriptActivation,
	renderTemplateAsHtmlString,
	mountTemplate,
	appendTemplate,
} = templatesFor('/parts/shells:themeManage/templates')
