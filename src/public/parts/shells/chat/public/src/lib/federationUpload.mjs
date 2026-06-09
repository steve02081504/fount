/**
 * 【文件】public/src/lib/federationUpload.mjs
 * 【职责】联邦文件分块上传辅助：单块上限常量与 ArrayBuffer→Base64。
 * 【原理】FEDERATION_CHUNK_MAX_BYTES=512KiB（§10.2）；arrayBufferToBase64 供分块 POST body。
 * 【数据结构】Uint8Array/ArrayBuffer、base64 字符串。
 * 【关联】ui/groupFileUpload.mjs、groupFileBlob.mjs。
 */
export const FEDERATION_CHUNK_MAX_BYTES = 512 * 1024

/**
 * @param {ArrayBuffer} buffer 原始二进制缓冲
 * @returns {string} 标准 Base64 文本
 */
export function arrayBufferToBase64(buffer) {
	let binary = ''
	const bytes = new Uint8Array(buffer)
	for (let index = 0; index < bytes.byteLength; index++)
		binary += String.fromCharCode(bytes[index])
	return btoa(binary)
}
