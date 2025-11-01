/**
 * 处理时间戳以用作ID。
 * @param {string} time_stamp - 时间戳。
 * @returns {string} - 处理后的ID。
 */
export function processTimeStampForId(time_stamp) {
	return time_stamp?.replaceAll?.(/[\s./:]/g, '_')
}

/**
 * 将ArrayBuffer转换为Base64。
 * @param {ArrayBuffer} buffer - ArrayBuffer。
 * @returns {string} - Base64字符串。
 */
export function arrayBufferToBase64(buffer) {
	let binary = ''
	const bytes = new Uint8Array(buffer)
	for (let i = 0; i < bytes.byteLength; i++)
		binary += String.fromCharCode(bytes[i])
	return window.btoa(binary)
}

/**
 * 滑动阈值。
 * @type {number}
 */
export const SWIPE_THRESHOLD = 50
/**
 * 过渡持续时间。
 * @type {number}
 */
export const TRANSITION_DURATION = 500
/**
 * 默认头像。
 * @type {string}
 */
export const DEFAULT_AVATAR = 'https://api.iconify.design/line-md/person.svg'
