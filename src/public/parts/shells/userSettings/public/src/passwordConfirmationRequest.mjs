/**
 * 用户设置 shell：密码确认弹窗与 `requestPasswordConfirmation()`（供本目录各模块静态 import）。
 */

const passwordConfirmationModal = document.getElementById('passwordConfirmationModal')
const confirmationPasswordInput = document.getElementById('confirmationPassword')
const confirmPasswordBtn = document.getElementById('confirmPasswordBtn')
const cancelPasswordBtn = document.getElementById('cancelPasswordBtn')

/** @type {{ resolve: (v: string) => void, reject: (e: Error) => void } | null} */
let passwordConfirmationContext = null

let cachedPassword = null
let passwordCacheTimeoutId = null

const PASSWORD_CACHE_DURATION = 3 * 60 * 1000

/**
 * 在校验成功后缓存密码（短时复用），避免再次弹窗。
 * @param {string} password - 已通过服务端校验的密码。
 * @returns {void}
 */
export function cacheVerifiedPassword(password) {
	cachedPassword = password
	if (passwordCacheTimeoutId)
		clearTimeout(passwordCacheTimeoutId)
	passwordCacheTimeoutId = setTimeout(() => {
		cachedPassword = null
		passwordCacheTimeoutId = null
	}, PASSWORD_CACHE_DURATION)
}

/**
 * 清除已缓存密码（服务端拒绝或需要强制重输时调用）。
 * @returns {void}
 */
export function invalidateCachedPassword() {
	cachedPassword = null
	if (passwordCacheTimeoutId) {
		clearTimeout(passwordCacheTimeoutId)
		passwordCacheTimeoutId = null
	}
}

/**
 * 请求密码确认。
 * @returns {Promise<string>} 确认的密码。
 */
export function requestPasswordConfirmation() {
	if (cachedPassword != null)
		return Promise.resolve(cachedPassword)

	if (passwordConfirmationModal.open || passwordConfirmationContext)
		return Promise.reject(Object.assign(new Error('Password confirmation already in progress.'), {
			name: 'PasswordConfirmationInProgressError',
		}))

	return new Promise((resolve, reject) => {
		passwordConfirmationContext = { resolve, reject }
		confirmationPasswordInput.value = ''
		passwordConfirmationModal.showModal()
		confirmationPasswordInput.focus()
	})
}

confirmPasswordBtn.addEventListener('click', () => {
	const ctx = passwordConfirmationContext
	const password = confirmationPasswordInput.value
	passwordConfirmationContext = null
	ctx?.resolve?.(password)
	passwordConfirmationModal.close()
})

cancelPasswordBtn.addEventListener('click', () => {
	passwordConfirmationContext?.reject?.(Object.assign(new Error('Password confirmation cancelled by user.'), {
		name: 'PasswordConfirmationCancelledError',
	}))
	passwordConfirmationContext = null
	passwordConfirmationModal.close()
})

passwordConfirmationModal.addEventListener('close', () => {
	if (passwordConfirmationModal.returnValue !== 'confirmed_via_button_logic_which_is_not_set')
		passwordConfirmationContext?.reject?.(Object.assign(new Error('Password confirmation dialog closed.'), {
			name: 'PasswordConfirmationClosedError',
		}))

	passwordConfirmationContext = null
})
