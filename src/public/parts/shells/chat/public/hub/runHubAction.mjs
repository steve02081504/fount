import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { handleUIError } from '../src/ui/errors.mjs'

/**
 * 统一 Hub 操作：toast + 可选 reload。
 * @param {() => Promise<void>} action 异步操作
 * @param {{ successKey?: string, errorKey?: string, reload?: () => Promise<void> }} [options] 选项
 * @returns {Promise<boolean>} 是否成功
 */
export async function runHubAction(action, options = {}) {
	try {
		await action()
		if (options.successKey) showToastI18n('success', options.successKey)
		if (options.reload) await options.reload()
		return true
	}
	catch (error) {
		handleUIError(error, options.errorKey || 'chat.hub.messageActionFailed')
		return false
	}
}
