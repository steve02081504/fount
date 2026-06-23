/**
 * Social bootstrap 就绪信号（模块级 Promise，供入口等待初始化完成）。
 */

/** @typedef {'pending' | 'ready' | 'error'} SocialAppState */

/** @type {SocialAppState} */
let socialAppState = 'pending'

/** @type {Error | null} */
let socialAppError = null

/** @type {Array<{ resolve: () => void, reject: (err: Error) => void }>} */
const socialAppWaiters = []

/**
 * @returns {SocialAppState} 当前 bootstrap 状态
 */
export function getSocialAppState() {
	return socialAppState
}

/**
 * @returns {Promise<void>}
 */
export function whenSocialAppReady() {
	if (socialAppState === 'ready') return Promise.resolve()
	if (socialAppState === 'error')
		return Promise.reject(socialAppError ?? new Error('Social bootstrap failed'))
	return new Promise((resolve, reject) => {
		socialAppWaiters.push({ resolve, reject })
	})
}

/** @returns {void} */
function flushSocialAppWaiters() {
	const waiters = socialAppWaiters.splice(0)
	for (const waiter of waiters)
		if (socialAppState === 'ready') waiter.resolve()
		else waiter.reject(socialAppError ?? new Error('Social bootstrap failed'))

}

/** @returns {void} */
function syncDatasetState() {
	document.documentElement.dataset.socialAppState = socialAppState
}

/** @returns {void} */
export function markSocialAppPending() {
	socialAppState = 'pending'
	socialAppError = null
	syncDatasetState()
}

/** @returns {void} */
export function markSocialAppReady() {
	socialAppState = 'ready'
	syncDatasetState()
	document.dispatchEvent(new CustomEvent('fount:social-app-ready'))
	flushSocialAppWaiters()
}

/**
 * @param {unknown} error 失败原因
 * @returns {void}
 */
export function markSocialAppFailed(error) {
	socialAppState = 'error'
	socialAppError = error instanceof Error ? error : new Error(String(error))
	syncDatasetState()
	document.dispatchEvent(new CustomEvent('fount:social-app-error', {
		detail: { message: socialAppError.message },
	}))
	flushSocialAppWaiters()
}
