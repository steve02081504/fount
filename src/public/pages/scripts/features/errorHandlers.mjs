/**
 * 前端错误处理：只报 fount 自身故障（toast + console + Sentry）。
 * 用户输入/操作过错请直接 `showToastI18n`，不要走这里。
 * 工厂形式便于 `.catch(handleError('key'))`。
 */
import * as Sentry from 'https://esm.sh/@sentry/browser'

import { showToastI18n } from './toast.mjs'

/**
 * @param {unknown} error 异常或字符串
 * @returns {Error} 规范化 Error
 */
function toError(error) {
	if (error instanceof Error) return error
	if (Object(error?.message) instanceof String) return new Error(error.message)
	return new Error(String(error))
}

/**
 * 用户可见的 fount 故障：toast + console + Sentry。
 * @param {string} i18nKey toast 文案键
 * @param {Record<string, unknown>} [toastParams] 额外 i18n 插值与 console 上下文（`error` 由本函数注入）
 * @param {unknown} [error] 若传入则立即处理，否则返回 `.catch` 闭包
 * @param {...unknown} extras 额外 console.error 参数
 * @returns {Error | ((error: unknown, ...extras: unknown) => Error)} 传入 error 时立即处理并返回 Error，否则返回 `.catch` 闭包
 */
export function handleError(i18nKey, toastParams = {}, error, ...extras) {
	/**
	 * @param {unknown} error 异常或字符串
	 * @param {...unknown} extras 额外 console.error 参数
	 * @returns {Error} 规范化 Error
	 */
	const handler = (error, ...extras) => {
		const err = toError(error)
		console.error(`[fount-ui] ${i18nKey}`, err, ...extras)
		showToastI18n('error', i18nKey, { ...toastParams, error: err.message })
		Sentry.captureException(err)
		return err
	}
	if (error) return handler(error, ...extras)
	return handler
}
