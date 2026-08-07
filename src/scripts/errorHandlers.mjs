/**
 * 后端错误处理：只报 fount 自身故障（console + Sentry）。
 * 用户输入/操作过错应返回 4xx / 业务错误给调用方，不要走这里。
 */
import * as Sentry from 'npm:@sentry/deno'

import { sentry_enabled } from './sentry_state.mjs'

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
 * fount 故障：console.error；Sentry 启用时再上报。
 * 可直接 `.catch(handleError)`。
 * @param {unknown} error 异常
 * @param {...unknown} extras 额外 console.error 参数
 * @returns {Error} 规范化 Error
 */
export function handleError(error, ...extras) {
	const err = toError(error)
	console.error(err, ...extras)
	if (sentry_enabled) Sentry.captureException(err)
	return err
}
