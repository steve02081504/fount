/**
 * Hub initCore 就绪信号（模块级 Promise，供入口等待初始化完成）。
 */

/** @typedef {'pending' | 'ready' | 'error'} HubCoreState */

/** @type {HubCoreState} */
let hubCoreState = 'pending'

/** @type {Error | null} */
let hubCoreError = null

/** @type {Array<{ resolve: () => void, reject: (err: Error) => void }>} */
const hubCoreWaiters = []

/**
 * @returns {HubCoreState} 当前 initCore 状态
 */
export function getHubCoreState() {
	return hubCoreState
}

/**
 * @returns {Promise<void>}
 */
export function whenHubCoreReady() {
	if (hubCoreState === 'ready') return Promise.resolve()
	if (hubCoreState === 'error')
		return Promise.reject(hubCoreError ?? new Error('Hub initCore failed'))
	return new Promise((resolve, reject) => {
		hubCoreWaiters.push({ resolve, reject })
	})
}

/** @returns {void} */
function flushHubCoreWaiters() {
	const waiters = hubCoreWaiters.splice(0)
	for (const waiter of waiters)
		if (hubCoreState === 'ready') waiter.resolve()
		else waiter.reject(hubCoreError ?? new Error('Hub initCore failed'))

}

/** @returns {void} */
function syncDatasetState() {
	document.documentElement.dataset.hubCoreState = hubCoreState
}

/** @returns {void} */
export function markHubCorePending() {
	hubCoreState = 'pending'
	hubCoreError = null
	syncDatasetState()
}

/** @returns {void} */
export function markHubCoreReady() {
	hubCoreState = 'ready'
	syncDatasetState()
	document.dispatchEvent(new CustomEvent('fount:hub-core-ready'))
	flushHubCoreWaiters()
}

/**
 * @param {unknown} error 失败原因
 * @returns {void}
 */
export function markHubCoreFailed(error) {
	hubCoreState = 'error'
	hubCoreError = error instanceof Error ? error : new Error(String(error))
	syncDatasetState()
	document.dispatchEvent(new CustomEvent('fount:hub-core-error', {
		detail: { message: hubCoreError.message },
	}))
	flushHubCoreWaiters()
}
