/**
 * code shell 的 `fount.user.send` 注册：与 chat 同语法（string | chatLogEntry），
 * 供消息内 HTML（选项按钮等）代用户向当前会话发消息；files 并入活动标签页的附件队列。
 */
import { normalizeUserSendPayload } from '/parts/shells:chat/shared/fountUserSend.mjs'
import { showToastI18n } from '/scripts/features/toast.mjs'

import { addFilesToRuntime } from './attachments.mjs'
import { getActiveRuntime } from './store.mjs'
import { submitMessage } from './submission.mjs'

/**
 * 注册 `globalThis.fount.user.send`（幂等）。
 * @returns {void}
 */
export function registerFountUserApi() {
	globalThis.fount ??= {}
	globalThis.fount.user ??= {}
	/**
	 * 代当前用户向当前 code 会话发送消息。
	 * @param {string | object} input 纯文本或近似 `chatLogEntry_t`
	 * @returns {Promise<void>} 发送完成。
	 */
	globalThis.fount.user.send = async input => {
		let payload
		try {
			payload = normalizeUserSendPayload(input)
		}
		catch (error) {
			showToastI18n('error', 'code.error.generic', { error: String(error?.message || error) })
			throw error
		}
		const content = String(payload.content.content ?? '').trim()
		const runtime = getActiveRuntime()
		if (payload.files.length && runtime) addFilesToRuntime(runtime.tabKey, payload.files)
		if (!content && !payload.files.length) return
		try {
			await submitMessage({ content })
		}
		catch (error) {
			showToastI18n('error', 'code.error.generic', { error: String(error?.message || error) })
		}
	}
}
