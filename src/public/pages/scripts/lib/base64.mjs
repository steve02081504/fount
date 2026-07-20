/**
 * @param {ArrayBuffer | ArrayBufferView} buffer 缓冲
 * @returns {string} base64
 */
export function arrayBufferToBase64(buffer) {
	const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
	const chunkSize = 0x8000
	let binary = ''
	for (let i = 0; i < bytes.length; i += chunkSize)
		binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize))
	return btoa(binary)
}

/**
 * @param {Blob} blob blob
 * @returns {Promise<string>} base64
 */
export async function blobToBase64(blob) {
	return arrayBufferToBase64(await blob.arrayBuffer())
}
