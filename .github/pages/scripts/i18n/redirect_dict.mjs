/**
 * GitHub blob 语言跳转（EULA / README）：浏览器语言 → 文档 locale。
 * 比 getBestLocale 多一层区域别名（zh-HK→zh-TW、en-GB→en-UK、pt-BR→pt-PT）。
 */
export const DOC_LOCALE_ALIAS = {
	zh: 'zh-CN', 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW', 'zh-HK': 'zh-TW',
	en: 'en-UK', 'en-UK': 'en-UK', 'en-GB': 'en-UK',
	ja: 'ja-JP', 'ja-JP': 'ja-JP',
	fr: 'fr-FR', 'fr-FR': 'fr-FR',
	es: 'es-ES', 'es-ES': 'es-ES',
	de: 'de-DE', 'de-DE': 'de-DE',
	ru: 'ru-RU', 'ru-RU': 'ru-RU',
	pt: 'pt-PT', 'pt-PT': 'pt-PT', 'pt-BR': 'pt-PT',
	hi: 'hi-IN', 'hi-IN': 'hi-IN',
	ko: 'ko-KR', 'ko-KR': 'ko-KR',
	it: 'it-IT', 'it-IT': 'it-IT',
	vi: 'vi-VN', 'vi-VN': 'vi-VN',
	ar: 'ar-SA', 'ar-SA': 'ar-SA',
	is: 'is-IS', 'is-IS': 'is-IS',
	nl: 'nl-NL', 'nl-NL': 'nl-NL',
	uk: 'uk-UA', 'uk-UA': 'uk-UA',
	lzh: 'lzh',
	emoji: 'emoji',
}

/**
 * 把 navigator 语言标签映射到仓库文档 locale。
 * @param {string} [raw] 原始语言标签
 * @returns {string} 文档 locale id
 */
export function resolveDocLocale(raw = navigator.language || navigator.userLanguage || '') {
	const [lang, region] = String(raw).split('-')
	const tag = region ? `${lang.toLowerCase()}-${region.toUpperCase()}` : lang.toLowerCase()
	return DOC_LOCALE_ALIAS[tag] || DOC_LOCALE_ALIAS[lang.toLowerCase()] || 'en-UK'
}

/**
 * 跳转到对应语言的 GitHub blob（保留 location.hash）。
 * @param {string} blobPrefix blob URL 前缀（至 locale 前，含末尾点）
 * @returns {void}
 */
export function redirectToLocalizedDoc(blobPrefix) {
	window.location.href = `${blobPrefix}.${resolveDocLocale()}.md${location.hash}`
}
