/**
 * 【文件】public/hub/messages/actions/actionError.mjs
 * 【职责】消息操作失败 toast：403 用无权限文案，其余带 error 详情。
 */
import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'

/**
 * @param {unknown} error 捕获的错误
 * @returns {void}
 */
export function toastMessageActionFailed(error) {
	if (error?.status === 403)
		return showToastI18n('error', 'chat.hub.message.action.noPermission')
	const message = String(error?.message || error)
	showToastI18n('error', 'chat.hub.message.action.failed', { error: message })
}
