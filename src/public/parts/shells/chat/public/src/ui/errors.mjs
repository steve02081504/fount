/**
 * 【文件】public/src/ui/errors.mjs
 * 【职责】前端用户可见错误统一处理：Sentry 上报 → console.error → i18n toast。
 * 【原理】handleUIError 将 unknown 规范为 Error 后三路汇报，避免 catch 仅改 UI 吞掉调试信息。
 * 【数据结构】error、i18nKey、toastParams。
 * 【关联】@sentry/browser、toast.mjs；Hub、groupFileUpload、reactionHandlers。
 */
import { showToastI18n } from '../../../../scripts/toast.mjs'

/**
 * @param {Error} err 上报目标
 * @returns {void}
 */
function reportToSentry(err) {
	import('https://esm.sh/@sentry/browser')
		.then(Sentry => Sentry.captureException(err))
		.catch(() => { })
}

/**
 * @param {unknown} error 异常或字符串
 * @returns {Error} 规范化 Error 实例
 */
export function toError(error) {
	if (error instanceof Error) return error
	if (error && typeof error === 'object' && typeof error.message === 'string')
		return new Error(error.message)
	return new Error(typeof error === 'string' ? error : String(error))
}

/**
 * 标准 fount 前端错误处理（toast + console.error + Sentry），三者缺一不可。
 * @param {unknown} error 异常
 * @param {string} i18nKey toast 文案键
 * @param {Record<string, string>} [toastParams] 额外 i18n 插值（`error` 由本函数注入）
 * @returns {Error} 规范化后的 Error
 */
export function handleUIError(error, i18nKey, toastParams = {}) {
	const err = toError(error)
	reportToSentry(err)
	console.error(`[fount-ui] ${i18nKey}`, err)
	showToastI18n('error', i18nKey, { ...toastParams, error: err.message })
	return err
}
