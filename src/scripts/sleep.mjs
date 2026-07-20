/**
 * @param {number} ms 毫秒
 * @returns {Promise<void>}
 */
export function sleep(ms) {
	return new Promise(resolve => { setTimeout(resolve, ms) })
}
