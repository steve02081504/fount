/**
 * 【文件】public/hub/fountUser.mjs
 * 【职责】在 window 上注册 `fount.user.send`，供消息内 HTML（选项按钮等）代用户发帖。
 * 【原理】string / chatLogEntry_t → 频道 content + files，再走 messageSend 乐观发送路径。
 */
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { primaryLocale } from '../../../../scripts/i18n/index.mjs'
import { normalizeUserSendPayload } from '../shared/fountUserSend.mjs'

/**
 *
 */
export { normalizeUserSendPayload } from '../shared/fountUserSend.mjs'

/**
 * 代当前用户向当前频道发消息。
 * @param {string | object} input 纯文本或近似 `chatLogEntry_t`
 * @returns {Promise<object>} 落盘后的 DAG message 事件
 */
export async function sendAsUser(input) {
	const { content, files } = normalizeUserSendPayload(input, {
		locale: primaryLocale(),
	})
	const { sendMessagePayload } = await import('./messages/messageSend.mjs')
	return sendMessagePayload(content, files)
}

/**
 * 注册 `globalThis.fount.user.send`（幂等）。
 * @returns {void}
 */
export function registerFountUserApi() {
	globalThis.fount ??= {}
	globalThis.fount.user ??= {}
	/**
	 * @param {string | object} input 纯文本或近似 `chatLogEntry_t`
	 * @returns {Promise<object>} 落盘后的 DAG message 事件
	 */
	globalThis.fount.user.send = async input => {
		try {
			return await sendAsUser(input)
		}
		catch (err) {
			showToastI18n('error', 'chat.hub.sendFailed', { error: err?.message || String(err) })
			throw err
		}
	}
}
