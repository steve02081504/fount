import {
	cacheTranslation as cacheTranslationBase,
	getCachedTranslation as getCachedTranslationBase,
	translateText,
} from '../../../../../server/translate.mjs'

const CACHE_DATANAME = 'socialTranslateCache'

/**
 * 写入翻译结果到 Social 用户缓存。
 * @param {string} username 用户
 * @param {string} cacheKey 缓存键
 * @param {string} translated 译文
 * @returns {void}
 */
export function cacheTranslation(username, cacheKey, translated) {
	cacheTranslationBase(username, CACHE_DATANAME, cacheKey, translated)
}

/**
 * 按缓存键读取 Social 已缓存的译文。
 * @param {string} username 用户
 * @param {string} cacheKey 缓存键
 * @returns {string | null} 缓存译文或 null
 */
export function getCachedTranslation(username, cacheKey) {
	return getCachedTranslationBase(username, CACHE_DATANAME, cacheKey)
}

export const translatePostText = translateText

export { translateText }
