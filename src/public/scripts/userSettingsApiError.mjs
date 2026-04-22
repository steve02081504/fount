/**
 * 用户设置相关 API 失败时抛出的错误形状（供 toast 读 `i18nKey` / `i18nParams`）。
 * @param {string} [i18nKey] - locale 键。
 * @param {Record<string, string | number>} [i18nParams] - 插值参数。
 */
export function throwUserSettingsApiError(i18nKey, i18nParams) {
	const key = String(i18nKey).trim()
	throw Object.assign(new Error('UserSettingsApiError'), {
		name: 'UserSettingsApiError',
		i18nKey: key,
		i18nParams,
	})
}
