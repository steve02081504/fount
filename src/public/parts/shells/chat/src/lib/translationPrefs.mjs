/**
 * @param {unknown} raw 原始偏好输入
 * @returns {{ autoTranslate: boolean, targetLocale?: string, excludeLocales?: string[] }} 规范化偏好
 */
export function normalizeTranslationPrefs(raw) {
	const input = raw || {}
	const prefs = { autoTranslate: input.autoTranslate === true }
	if (input.targetLocale != null) prefs.targetLocale = String(input.targetLocale)
	if (Array.isArray(input.excludeLocales))
		prefs.excludeLocales = input.excludeLocales.map(String)
	return prefs
}
