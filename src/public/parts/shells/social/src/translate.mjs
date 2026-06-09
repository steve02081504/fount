import { loadData, saveData } from '../../../../../server/setting_loader.mjs'

const CACHE_DATANAME = 'socialTranslateCache'

/**
 * 读取用户翻译结果缓存表。
 * @param {string} username 用户
 * @returns {Record<string, string>} 缓存条目表
 */
function loadTranslateCache(username) {
	const store = loadData(username, CACHE_DATANAME)
	store.entries ??= {}
	return store.entries
}

/**
 * 写入翻译结果到用户缓存。
 * @param {string} username 用户
 * @param {string} cacheKey 缓存键
 * @param {string} translated 译文
 * @returns {void}
 */
export function cacheTranslation(username, cacheKey, translated) {
	const store = loadData(username, CACHE_DATANAME)
	store.entries ??= {}
	store.entries[cacheKey] = translated
	saveData(username, CACHE_DATANAME)
}

/**
 * 按缓存键读取已缓存的译文。
 * @param {string} username 用户
 * @param {string} cacheKey 缓存键
 * @returns {string | null} 缓存译文或 null
 */
export function getCachedTranslation(username, cacheKey) {
	const entries = loadTranslateCache(username)
	return entries[cacheKey] ?? null
}

/**
 * 调用 translate serviceGenerator 翻译帖子正文。
 * @param {string} text 原文
 * @param {string} targetLang 目标语言
 * @returns {Promise<string>} 译文（失败时返回原文）
 */
export async function translatePostText(text, targetLang) {
	if (!text) return ''
	try {
		const { getPartList, loadPart } = await import('../../../../../server/parts_loader.mjs')
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
