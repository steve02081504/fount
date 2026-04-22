/**
 * 将用户设置 shell 的 API 错误体（i18nKey）转为 toast；与 {@link ./endpoints.mjs} 分离，避免把 UI 绑在 fetch 层。
 */

import { showToastI18n } from '/scripts/toast.mjs'
import { throwUserSettingsApiError } from '/scripts/userSettingsApiError.mjs'

/**
 * @param {any} error - 捕获到的错误。
 * @returns {boolean} 是否为密码弹窗取消或关闭（不应再 toast）。
 */
export function isPasswordConfirmationDialogDismissed(error) {
	if (!error) return false
	return ['PasswordConfirmationCancelledError', 'PasswordConfirmationClosedError', 'PasswordConfirmationInProgressError'].includes(error.name)
}

/**
 * 抛出用于「服务端未给出 i18nKey」场景的兜底错误。
 */
export function throwUnexpectedUserSettingsApiError() {
	throwUserSettingsApiError('userSettings.shell.unexpectedError')
}

/**
 * 仅把服务端约定字段交给 `showToastI18n`：负载或 `UserSettingsApiError` 须有 `i18nKey`（可选 `i18nParams`）；任意 `Error.message` 不会直接作为 toast 文案。
 * @param {'info'|'success'|'warning'|'error'} type - toast 级别。
 * @param {{ i18nKey?: string, i18nParams?: Record<string, string | number> } | Error} payload - JSON 体或 fetch reject 合并后的 Error。
 * @param {number} [duration] - 显示时长（毫秒），可选。
 * @returns {void}
 */
export function showToastForApiPayload(type, payload, duration) {
	if (payload.i18nKey)
		showToastI18n(type, String(payload.i18nKey).trim(), payload.i18nParams, duration)
	else
		showToastI18n(type, 'userSettings.shell.unexpectedError', {}, duration)
}
