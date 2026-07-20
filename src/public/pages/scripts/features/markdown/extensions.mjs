import { importRegistryModules } from '../../api/registries.mjs'

/** @type {Promise<{ remarkPlugins: unknown[], rehypePlugins: unknown[], css: string, inits: Array<() => void>, version: string }> | null} */
let loadPromise = null
/** @type {boolean} */
let initsRan = false

/**
 * 加载并合并所有已注册的 markdown 扩展。
 * @returns {Promise<{ remarkPlugins: unknown[], rehypePlugins: unknown[], css: string, inits: Array<() => void>, version: string }>} 合并后的扩展配置。
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

			for (const { entry, module } of modules) {
				const extension = module.default ?? module
				versionParts.push(entry.id)
				remarkPlugins.push(...extension.remarkPlugins ?? [])
				rehypePlugins.push(...extension.rehypePlugins ?? [])
				if (extension.css) cssParts.push(extension.css)
				if (extension.init) inits.push(extension.init)
			}

			return {
				remarkPlugins,
				rehypePlugins,
				css: cssParts.join('\n'),
				inits,
				version: versionParts.join(','),
			}
		})()
	
	return loadPromise
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
