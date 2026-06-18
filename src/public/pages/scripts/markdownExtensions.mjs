import { importRegistryModules } from './registries.mjs'

/** @type {Promise<{ remarkPlugins: unknown[], rehypePlugins: unknown[], css: string, inits: Array<() => void>, version: string }> | null} */
let loadPromise = null
/** @type {boolean} */
let initsRan = false

/**
 * 加载并合并所有已注册的 markdown 扩展。
 * @returns {Promise<{ remarkPlugins: unknown[], rehypePlugins: unknown[], css: string, inits: Array<() => void>, version: string }>}
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
				const ext = module?.default ?? module
				if (!ext || typeof ext !== 'object') continue
				versionParts.push(entry.id)
				if (Array.isArray(ext.remarkPlugins))
					remarkPlugins.push(...ext.remarkPlugins)
				if (Array.isArray(ext.rehypePlugins))
					rehypePlugins.push(...ext.rehypePlugins)
				if (typeof ext.css === 'string' && ext.css.trim())
					cssParts.push(ext.css)
				if (typeof ext.init === 'function')
					inits.push(ext.init)
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
 * @returns {Promise<void>}
 */
export async function ensureMarkdownExtensionAssets() {
	const { css, inits } = await loadRegisteredMarkdownExtensions()
	if (css && !document.getElementById('fount-markdown-extensions-css')) {
		const style = document.createElement('style')
		style.id = 'fount-markdown-extensions-css'
		style.textContent = css
		document.head.appendChild(style)
	}
	if (!initsRan) {
		initsRan = true
		for (const init of inits)
			try { init() } catch { /* ignore */ }
	}
}

/**
 * 清除扩展加载缓存（registry 更新后调用）。
 * @returns {void}
 */
export function invalidateMarkdownExtensionsCache() {
	loadPromise = null
	initsRan = false
	const style = document.getElementById('fount-markdown-extensions-css')
	if (style) style.remove()
}

/**
 * 已注册扩展的版本指纹（用于 processor 缓存键）。
 * @returns {Promise<string>}
 */
export async function getMarkdownExtensionsVersion() {
	const { version } = await loadRegisteredMarkdownExtensions()
	return version
}
