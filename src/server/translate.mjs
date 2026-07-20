import { loadData, saveData } from './setting_loader.mjs'

/**
 * 写入翻译结果到用户指定 dataname 缓存。
 * @param {string} username 用户
 * @param {string} dataname 缓存 dataname
 * @param {string} key 缓存键
 * @param {string} text 译文
 * @returns {void}
 */
export function cacheTranslation(username, dataname, key, text) {
	const store = loadData(username, dataname)
	store.entries ??= {}
	store.entries[key] = text
	saveData(username, dataname)
}

/**
 * 按缓存键读取已缓存的译文。
 * @param {string} username 用户
 * @param {string} dataname 缓存 dataname
 * @param {string} key 缓存键
 * @returns {string | null} 缓存译文或 null
 */
export function getCachedTranslation(username, dataname, key) {
	const store = loadData(username, dataname)
	store.entries ??= {}
	return store.entries[key] ?? null
}

/**
 * 调用 translate serviceGenerator 翻译文本。
 * @param {string} text 原文
 * @param {string} targetLang 目标语言
 * @returns {Promise<string>} 译文（失败时返回原文）
 */
export async function translateText(text, targetLang) {
	if (!text) return ''
	try {
		const { getPartList, loadPart } = await import('./parts_loader.mjs')
		const generators = await getPartList('serviceGenerators/translate')
		if (!generators.length) return text
		const generatorPart = await loadPart(generators[0].partpath)
		const generator = await generatorPart.Get?.('default', {})
		if (!generator?.Translate) return text
		const translated = await generator.Translate(text, targetLang)
		return String(translated?.text ?? text)
	}
	catch {
		return text
	}
}
