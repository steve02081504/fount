import { showToastI18n } from '../../../../scripts/toast.mjs'
import { handleUIError } from '../src/ui/errors.mjs'

/**
 * 统一 Hub 操作：toast + 可选 reload。
 * @param {() => Promise<void>} action 异步操作
 * @param {{ successKey?: string, errorKey?: string, reload?: () => Promise<void> }} [opts] 选项
 * @returns {Promise<boolean>} 是否成功
 */
export async function runHubAction(action, opts = {}) {
	try {
		await action()
		if (opts.successKey) showToastI18n('success', opts.successKey)
		if (opts.reload) await opts.reload()
		return true
	}
	catch (error) {
		handleUIError(error, opts.errorKey || 'chat.hub.messageActionFailed')
		return false
	}
}
