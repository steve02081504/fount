/**
 * 【文件】public/profile/ownerConfirmDialog.mjs
 * 【职责】设置主人前的高风险二次确认（冷却 + 两次点击）。
 * 【原理】openDialogFromTemplate；确认后由调用方 PUT entities/owner。
 */
import { openDialogFromTemplate } from '../../../scripts/features/dialog.mjs'
import { setElementI18n } from '../../../scripts/i18n/index.mjs'

const COOLDOWN_SECONDS = 5
const SECOND_CONFIRM_TIMEOUT_MS = 3000

/**
 * 设置主人前强制警告：5 秒冷却 + 两次确认。
 * @param {string} ownerEntityHash 将要设置的主人 entityHash
 * @returns {Promise<boolean>} 用户最终确认为 true；取消为 false
 */
export function showOwnerConfirmDialog(ownerEntityHash) {
	const ownerLabel = String(ownerEntityHash || '').trim().toLowerCase()
	if (!ownerLabel) return Promise.resolve(false)

	return new Promise((resolve, reject) => {
		let cooldownRemaining = COOLDOWN_SECONDS
		let confirmPhase = 0
		/** @type {ReturnType<typeof setInterval> | null} */
		let cooldownTimer = null
		/** @type {ReturnType<typeof setTimeout> | null} */
		let secondConfirmResetTimer = null
		/** @type {boolean} */
		let settled = false

		/**
		 * @param {boolean} value 结果
		 * @param {HTMLDialogElement} [dialog] 对话框
		 * @returns {void}
		 */
		const finish = (value, dialog) => {
			if (settled) return
			settled = true
			if (cooldownTimer) clearInterval(cooldownTimer)
			if (secondConfirmResetTimer) clearTimeout(secondConfirmResetTimer)
			dialog?.close()
			resolve(value)
		}

		openDialogFromTemplate('profile/owner_confirm', { ownerLabel }, {
			/**
			 * @param {HTMLDialogElement} dialog 对话框
			 * @returns {void}
			 */
			onReady: (dialog) => {
				const confirmButton = dialog.querySelector('#profile-owner-confirm-button')
				if (!(confirmButton instanceof HTMLButtonElement)) {
					finish(false, dialog)
					return
				}

				/**
				 * @returns {void}
				 */
				const updateConfirmButtonLabel = () => {
					if (confirmPhase === 0) {
						if (cooldownRemaining > 0) {
							confirmButton.disabled = true
							setElementI18n(confirmButton, 'chat.profile.ownerConfirmCooldown', { seconds: String(cooldownRemaining) })
						}
						else {
							confirmButton.disabled = false
							setElementI18n(confirmButton, 'chat.profile.ownerConfirmFirst')
						}
						return
					}
					confirmButton.disabled = false
					setElementI18n(confirmButton, 'chat.profile.ownerConfirmSecond')
				}

				/**
				 * @returns {void}
				 */
				const resetToFirstPhase = () => {
					confirmPhase = 0
					if (secondConfirmResetTimer) {
						clearTimeout(secondConfirmResetTimer)
						secondConfirmResetTimer = null
					}
					updateConfirmButtonLabel()
				}

				dialog.addEventListener('cancel', () => finish(false), { once: true })
				dialog.querySelector('[data-dialog-cancel]')?.addEventListener('click', () => finish(false, dialog), { once: true })
				confirmButton.addEventListener('click', () => {
					if (confirmPhase === 0) {
						if (cooldownRemaining > 0) return
						confirmPhase = 1
						updateConfirmButtonLabel()
						secondConfirmResetTimer = setTimeout(resetToFirstPhase, SECOND_CONFIRM_TIMEOUT_MS)
						return
					}
					finish(true, dialog)
				})

				updateConfirmButtonLabel()
				cooldownTimer = setInterval(() => {
					if (confirmPhase !== 0) return
					cooldownRemaining -= 1
					if (cooldownRemaining <= 0) {
						cooldownRemaining = 0
						if (cooldownTimer) clearInterval(cooldownTimer)
						cooldownTimer = null
					}
					updateConfirmButtonLabel()
				}, 1000)
			},
		}).catch(reject)
	})
}
