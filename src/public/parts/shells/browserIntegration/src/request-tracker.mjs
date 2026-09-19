import { setTimeout } from 'node:timers'

export const REQUEST_TIMEOUT_MS = 15_000
const REQUEST_TIMEOUT_MESSAGE = 'Request timed out after 15 seconds.'

/**
 * Tracks browser userscript requests until a response or the existing timeout settles them.
 */
export class RequestTracker {
	/**
	 * @param {object} [options] Tracker options.
	 * @param {typeof setTimeout} [options.scheduleTimeout=setTimeout] Timeout scheduler.
	 */
	constructor({ scheduleTimeout = setTimeout } = {}) {
		this.scheduleTimeout = scheduleTimeout
		this.pendingRequests = new Map()
	}

	/**
	 * Register a request and dispatch it while the Promise executor is active.
	 * @param {string} requestId Request identifier.
	 * @param {() => void} dispatch Sends the request.
	 * @returns {Promise<any>} Response payload.
	 */
	request(requestId, dispatch) {
		return new Promise((resolve, reject) => {
			this.requestWithResolvers(requestId, dispatch, resolve, reject)
		})
	}

	/**
	 * Register and dispatch a request using an existing Promise executor's handlers.
	 * @param {string} requestId Request identifier.
	 * @param {() => void} dispatch Sends the request.
	 * @param {(value: any) => void} resolve Existing Promise resolve handler.
	 * @param {(reason?: any) => void} reject Existing Promise reject handler.
	 */
	requestWithResolvers(requestId, dispatch, resolve, reject) {
		this.pendingRequests.set(requestId, { resolve, reject })

		this.scheduleTimeout(() => {
			if (this.pendingRequests.has(requestId)) {
				this.pendingRequests.delete(requestId)
				reject(new Error(REQUEST_TIMEOUT_MESSAGE))
			}
		}, REQUEST_TIMEOUT_MS)

		dispatch()
	}

	/**
	 * Whether a request is still pending.
	 * @param {string} requestId Request identifier.
	 * @returns {boolean} True when pending.
	 */
	has(requestId) {
		return this.pendingRequests.has(requestId)
	}

	/**
	 * Resolve a pending request.
	 * @param {string} requestId Request identifier.
	 * @param {any} payload Response payload.
	 * @returns {boolean} True when a request was settled.
	 */
	resolve(requestId, payload) {
		const pendingRequest = this.pendingRequests.get(requestId)
		if (!pendingRequest) return false

		pendingRequest.resolve(payload)
		this.pendingRequests.delete(requestId)
		return true
	}

	/**
	 * Reject a pending request.
	 * @param {string} requestId Request identifier.
	 * @param {Error} error Rejection error.
	 * @returns {boolean} True when a request was settled.
	 */
	reject(requestId, error) {
		const pendingRequest = this.pendingRequests.get(requestId)
		if (!pendingRequest) return false

		pendingRequest.reject(error)
		this.pendingRequests.delete(requestId)
		return true
	}
}
