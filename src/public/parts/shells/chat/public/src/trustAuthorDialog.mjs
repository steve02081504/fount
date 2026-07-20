/**
 * 【文件】public/src/trustAuthorDialog.mjs
 * 【职责】不可信作者「信任」二次确认弹层（冷却 + 超时）。
 * 【原理】openOverlayModal 展示模板；确认后 addTrustedAuthor(TRUST_EXPIRES_NEVER)。
 * 【数据结构】authorPubKeyHash、COOLDOWN_SECONDS、SECOND_CONFIRM_TIMEOUT_MS。
 * 【关联】trustedAuthors.mjs、hub/overlayModal.mjs。
 */
import { renderTemplate, usingTemplates } from '../../../scripts/features/template.mjs'
import { closeOverlayModal, openOverlayModal } from '../hub/core/overlayModal.mjs'

import { addTrustedAuthor, TRUST_EXPIRES_NEVER } from './trustedAuthors.mjs'

const COOLDOWN_SECONDS = 5
const SECOND_CONFIRM_TIMEOUT_MS = 3000

/** @typedef {'3h' | '7d' | '1m' | 'forever'} TrustDurationChoice */

/**
 * @param {TrustDurationChoice} choice 用户选择的信任时长
 * @returns {number} 过期时间戳（ms）或 TRUST_EXPIRES_NEVER
 */
function expiresAtForDurationChoice(choice) {
	const now = Date.now()
	switch (choice) {
		case '3h':
			return now + 3 * 3600 * 1000
		case '7d':
			return now + 7 * 86400 * 1000
		case '1m':
			return now + 30 * 86400 * 1000
		default:
			return TRUST_EXPIRES_NEVER
	}
}

/**
 * 信任作者前强制警告：5 秒冷却 + 两次确认 + 可选信任时长。
 * @param {string} authorPubKeyHash 作者公钥哈希
 * @param {string} [authorDisplayName] 展示用作者名
 * @returns {Promise<boolean>} 用户完成信任为 true；取消为 false
 */
export function showTrustAuthorDialog(authorPubKeyHash, authorDisplayName = '') {
	if (!authorPubKeyHash) return Promise.resolve(false)

	return new Promise((resolve) => {
		void (async () => {
		/** @type {TrustDurationChoice} */
			let selectedDuration = '7d'
			let cooldownRemaining = COOLDOWN_SECONDS
			let confirmPhase = 0
			/** @type {ReturnType<typeof setInterval> | null} */
			let cooldownTimer = null
			/** @type {ReturnType<typeof setTimeout> | null} */
			let secondConfirmResetTimer = null

			const authorLabel = authorDisplayName?.trim() || authorPubKeyHash.slice(0, 12)

			const durationOptions = [
				{ value: '3h', labelKey: 'chat.hub.trustAuthorDialog.duration3h' },
				{ value: '7d', labelKey: 'chat.hub.trustAuthorDialog.duration7d' },
				{ value: '1m', labelKey: 'chat.hub.trustAuthorDialog.duration1Month' },
				{ value: 'forever', labelKey: 'chat.hub.trustAuthorDialog.durationForever' },
			]

			/**
		 * @returns {void}
		 */
			const cleanup = () => {
				if (cooldownTimer) clearInterval(cooldownTimer)
				if (secondConfirmResetTimer) clearTimeout(secondConfirmResetTimer)
				closeOverlayModal()
			}

			/**
		 * @returns {HTMLElement | null} 确认按钮元素
		 */
			const getConfirmButton = () => document.getElementById('trust-author-confirm-button')

			/**
		 * @returns {void}
		 */
			const updateConfirmButtonLabel = () => {
				const confirmButton = getConfirmButton()
				if (!confirmButton) return
				if (confirmPhase === 0) 
					if (cooldownRemaining > 0) {
						confirmButton.disabled = true
						confirmButton.dataset.i18n = 'chat.hub.trustAuthorDialog.confirmCooldown'
						confirmButton.dataset.seconds = String(cooldownRemaining)
					}
					else {
						confirmButton.disabled = false
						confirmButton.dataset.i18n = 'chat.hub.trustAuthorDialog.confirmFirst'
						delete confirmButton.dataset.seconds
					}
			
				else {
					confirmButton.disabled = false
					confirmButton.dataset.i18n = 'chat.hub.trustAuthorDialog.confirmSecond'
					delete confirmButton.dataset.seconds
				}
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


			usingTemplates('/parts/shells:chat/src/templates')
			const trustRoot = await renderTemplate('hub/modals/trust_author', {
				authorLabel,
				durationOptions: durationOptions.map(option => ({
					...option,
					checked: option.value === selectedDuration,
				})),
			})

			openOverlayModal({
				titleKey: 'chat.hub.trustAuthorDialog.title',
				subtitleKey: 'chat.hub.trustAuthorDialog.subtitle',
				subtitleParams: { author: authorLabel },
				body: trustRoot.querySelector('[data-trust-part="body"]'),
				footer: trustRoot.querySelector('[data-trust-part="footer"]'),
			})

			document.getElementById('trust-author-duration-options')?.addEventListener('change', (event) => {
				const {target} = event
				if (target instanceof HTMLInputElement && target.name === 'trust-duration')
					selectedDuration = /** @type {TrustDurationChoice} */ (target.value)
			})

			document.getElementById('trust-author-cancel-button')?.addEventListener('click', () => {
				cleanup()
				resolve(false)
			})

			getConfirmButton()?.addEventListener('click', async () => {
				if (confirmPhase === 0) {
					if (cooldownRemaining > 0) return
					confirmPhase = 1
					updateConfirmButtonLabel()
					secondConfirmResetTimer = setTimeout(resetToFirstPhase, SECOND_CONFIRM_TIMEOUT_MS)
					return
				}
				const expiresAt = expiresAtForDurationChoice(selectedDuration)
				await addTrustedAuthor(authorPubKeyHash, expiresAt)
				cleanup()
				resolve(true)
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
		})()
	})
}
