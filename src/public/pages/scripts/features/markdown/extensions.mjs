import { importRegistryModules } from '../../endpoints/registries.mjs'

/** @type {Promise<{ remarkPlugins: unknown[], rehypePlugins: unknown[], css: string, inits: Array<() => void>, version: string, inlineTokens: Array<object>, mentionSuggest: Array<Function> }> | null} */
let loadPromise = null
/** @type {boolean} */
let initsRan = false
/** @type {Array<object>} 已注册的编辑器 inline token 定义（同步访问）。 */
let registeredInlineTokens = []
/** @type {Array<Function>} 已注册的 @ 候选 provider（同步访问）。 */
let registeredMentionSuggest = []

/**
 * 加载并合并所有已注册的 markdown 扩展。
 *
 * 每个扩展模块的默认导出可声明：
 * - `remarkPlugins` / `rehypePlugins` / `css` / `init`：渲染管线（remark/rehype）。
 * - `inlineTokens`：编辑器（markdownRichInput）的 inline token 定义，每项含
 *   `{ kind, regex, parse?, resolveLabel?, buildChip? }`。
 * - `mentionSuggest`：@ 候选 provider，`(ctx, query, limit) => Promise<rows | null>`，null 表示不处理该上下文。
 * @returns {Promise<{ remarkPlugins: unknown[], rehypePlugins: unknown[], css: string, inits: Array<() => void>, version: string, inlineTokens: Array<object>, mentionSuggest: Array<Function> }>} 合并后的扩展配置。
 */
export async function loadRegisteredMarkdownExtensions() {
	if (!loadPromise)
		loadPromise = (async () => {
			const modules = await importRegistryModules('markdown_extensions')
			/** @type {unknown[]} */
			const remarkPlugins = []
			/** @type {unknown[]} */
			const rehypePlugins = []
			const cssParts = []
			/** @type {Array<() => void>} */
			const inits = []
			const versionParts = []
			/** @type {Array<object>} */
			const inlineTokens = []
			/** @type {Array<Function>} */
			const mentionSuggest = []

			for (const { entry, module } of modules) {
				const extension = module.default ?? module
				versionParts.push(entry.id)
				remarkPlugins.push(...extension.remarkPlugins ?? [])
				rehypePlugins.push(...extension.rehypePlugins ?? [])
				if (extension.css) cssParts.push(extension.css)
				if (extension.init) inits.push(extension.init)
				inlineTokens.push(...extension.inlineTokens ?? [])
				mentionSuggest.push(...extension.mentionSuggest ?? [])
			}

			registeredInlineTokens = inlineTokens
			registeredMentionSuggest = mentionSuggest

			return {
				remarkPlugins,
				rehypePlugins,
				css: cssParts.join('\n'),
				inits,
				version: versionParts.join(','),
				inlineTokens,
				mentionSuggest,
			}
		})()

	return loadPromise
}

/**
 * 同步获取已加载的编辑器 inline token 定义。
 *
 * 未加载完成时返回空数组；创建同步组件后用 `loadRegisteredMarkdownExtensions()`
 * 的 then 回调重建一次即可。
 * @returns {Array<object>} inline token 定义列表。
 */
export function getRegisteredInlineTokens() {
	return registeredInlineTokens
}

/**
 * 同步获取已注册的 @ 候选 provider 列表。
 * @returns {Array<Function>} mention suggest provider 列表。
 */
export function getRegisteredMentionSuggest() {
	return registeredMentionSuggest
}

/**
 * 注入已注册扩展的 CSS 并运行 init（仅一次）。
 * @returns {Promise<Awaited<ReturnType<typeof loadRegisteredMarkdownExtensions>>>} 合并后的扩展配置。
 */
export async function ensureMarkdownExtensionAssets() {
	const registered = await loadRegisteredMarkdownExtensions()
	if (registered.css && !document.getElementById('fount-markdown-extensions-css')) {
		const style = document.createElement('style')
		style.id = 'fount-markdown-extensions-css'
		style.textContent = registered.css
		document.head.appendChild(style)
	}
	if (!initsRan) {
		initsRan = true
		for (const init of registered.inits)
			init()
	}
	return registered
}
