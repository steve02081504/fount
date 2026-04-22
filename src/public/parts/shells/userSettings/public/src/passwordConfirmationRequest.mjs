/**
 * 用户设置 shell：密码确认弹窗与 `requestPasswordConfirmation()`（供本目录各模块静态 import）。
 */

import { console } from '/scripts/i18n.mjs'

const passwordConfirmationModal = document.getElementById('passwordConfirmationModal')
const confirmationPasswordInput = document.getElementById('confirmationPassword')
const confirmPasswordBtn = document.getElementById('confirmPasswordBtn')
const cancelPasswordBtn = document.getElementById('cancelPasswordBtn')

let passwordConfirmationContext = { resolve: null, reject: null }
let cachedPassword = null
let passwordCacheTimeoutId = null

const PASSWORD_CACHE_DURATION = 3 * 60 * 1000

/**
 * 请求密码确认。
 * @returns {Promise<string>} 确认的密码。
 */
export function requestPasswordConfirmation() {
	return new Promise((resolve, reject) => {
		if (cachedPassword) {
			console.log('Using cached password.')
			resolve(cachedPassword)
			return
		}

		passwordConfirmationContext = { resolve, reject }
		confirmationPasswordInput.value = ''
		passwordConfirmationModal.showModal()
		confirmationPasswordInput.focus()
	})
}

confirmPasswordBtn.addEventListener('click', () => {
	const password = confirmationPasswordInput.value
	passwordConfirmationContext.resolve?.(password)
	cachedPassword = password

	if (passwordCacheTimeoutId)
		clearTimeout(passwordCacheTimeoutId)

	passwordCacheTimeoutId = setTimeout(() => {
		cachedPassword = null
		passwordCacheTimeoutId = null
	}, PASSWORD_CACHE_DURATION)

	passwordConfirmationModal.close()
})

cancelPasswordBtn.addEventListener('click', () => {
	passwordConfirmationContext.reject?.(Object.assign(new Error('Password confirmation cancelled by user.'), {
		name: 'PasswordConfirmationCancelledError'
	}))
	passwordConfirmationModal.close()
})

passwordConfirmationModal.addEventListener('close', () => {
	if (passwordConfirmationModal.returnValue !== 'confirmed_via_button_logic_which_is_not_set')
		passwordConfirmationContext.reject?.(Object.assign(new Error('Password confirmation dialog closed.'), {
			name: 'PasswordConfirmationClosedError'
		}))

	passwordConfirmationContext = { resolve: null, reject: null }
})
