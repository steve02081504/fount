/**
 * 依据配置组装 AI 源本地化 info：模型名优先作源名称，API URL 被覆写时 provider 取该 URL 域名。
 */

/**
 * 按配置生成各 locale 的 AI 源 info。
 * @param {Record<string, object>} product_info - 生成器默认本地化产品信息。
 * @param {object} [config] - AI 源配置。
 * @param {object} [options] - 选项。
 * @param {string} [options.url] - 当前 API URL；仅当与 `defaultUrl` 不同（用户覆写）时才用于 provider。
 * @param {string} [options.defaultUrl] - 生成器模板中的默认 API URL。
 * @param {string} [options.fallbackName] - 未指定 model / name 时的备用名称。
 * @returns {Record<string, object>} 本地化 info。
 */
export function buildSourceInfo(product_info, config = {}, { url, defaultUrl, fallbackName } = {}) {
	let provider
	if (url && url !== defaultUrl)
		try {
			provider = new URL(url).hostname
		}
		catch {
			// 非法 URL 时保留默认 provider
		}

	return Object.fromEntries(Object.entries(structuredClone(product_info)).map(([locale, localeInfo]) => {
		localeInfo.name = config?.model || config?.name || fallbackName || localeInfo.name
		if (provider) localeInfo.provider = provider
		return [locale, localeInfo]
	}))
}
