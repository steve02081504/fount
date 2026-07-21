/**
 * Sentry 启用状态与初始化的独立模块。
 */
import * as Sentry from 'npm:@sentry/deno'

/**
 * 是否启用 Sentry 进行错误报告。
 * @type {boolean}
 */
export let sentry_enabled

/**
 * 设置 Sentry 是否启用，并在启用时初始化 Sentry。
 * @param {boolean} new_sentry_enabled - 是否启用 Sentry。
 * @returns {void}
 */
export function set_sentry_enabled(new_sentry_enabled) {
	try {
		// deno-lint-ignore no-cond-assign
		if (sentry_enabled = new_sentry_enabled) Sentry.init({
			dsn: 'https://17e29e61e45e4da826ba5552a734781d@o4509258848403456.ingest.de.sentry.io/4509258936090704',
		})
		else Sentry.close().catch(console.error)
	} catch (error) { console.error(error) }
}
