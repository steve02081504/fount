/**
 * 生成紧凑 locales（en-UK / zh-CN / emoji），供语音识别生成器使用。
 * @param {{
 *   nameEn: string, nameZh: string,
 *   descEn: string, descZh: string,
 *   mdEn?: string, mdZh?: string,
 *   avatar: string,
 *   provider: string,
 *   tagsEn?: string[], tagsZh?: string[],
 *   home?: string,
 * }} meta 元数据
 * @returns {object} locales.json 根对象
 */
export function makeSpeechRecognitionLocales(meta) {
	const {
		nameEn, nameZh, descEn, descZh,
		mdEn = descEn, mdZh = descZh,
		avatar, provider,
		tagsEn = ['speechRecognition', 'generator'],
		tagsZh = ['语音识别', '生成器'],
		home = '',
	} = meta
	const infoLocale = (name, description, description_markdown, tags) => ({
		name,
		avatar,
		description,
		description_markdown,
		version: '0.0.0',
		author: 'steve02081504',
		home_page: home,
		tags,
	})
	const productLocale = (name, description, description_markdown, tags) => ({
		...infoLocale(name, description, description_markdown, tags),
		provider,
	})
	return {
		info: {
			'en-UK': infoLocale(nameEn, descEn, mdEn, tagsEn),
			'zh-CN': infoLocale(nameZh, descZh, mdZh, tagsZh),
			emoji: infoLocale('🎙️🏭', '🎙️➡️📝', '🎙️➡️📝', ['🎙️', '🏭']),
		},
		product_info: {
			'en-UK': productLocale(nameEn.replace(/ Generator$/i, ''), descEn, mdEn, tagsEn),
			'zh-CN': productLocale(nameZh.replace(/生成器$/i, ''), descZh, mdZh, tagsZh),
			emoji: productLocale('🎙️', '🎙️➡️📝', '🎙️➡️📝', ['🎙️']),
		},
	}
}
