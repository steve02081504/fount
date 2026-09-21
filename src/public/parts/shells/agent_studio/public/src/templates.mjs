/**
 * 【文件】public/src/templates.mjs — agent_studio 前端 HTML 模板入口
 * 【职责】暴露 `renderTemplate` 等模板 API，模板目录为 `public/src/templates/`。
 * 【原理】复用 `templatesFor`，以部件 URL 前缀解析模板文件。
 * 【关联】public/index.mjs、templates/*.html。
 */
import { templatesFor } from '/scripts/features/template.mjs'

/**
 * agent_studio 模板渲染 / 挂载 API。
 */
export const {
	renderTemplate,
	renderTemplateNoScriptActivation,
	renderTemplateAsHtmlString,
	mountTemplate,
	appendTemplate,
} = templatesFor('/parts/shells:agent_studio/src/templates')
