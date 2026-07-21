/**
 * Litterbox / Catbox 短时文件上传与下载。
 */

const CATBOX_API_URL = 'https://litterbox.catbox.moe/resources/internals/api.php'
const CATBOX_SERVE_HOST = 'https://litter.catbox.moe'

/**
 * 将文本上传到 Litterbox 并返回文件 ID。
 * @param {string} content 要上传的内容
 * @param {string} [expiration='1h'] 过期时间（例如 "1h"、"24h"）
 * @param {string} [filename='fount_upload.txt'] 上传文件名
 * @returns {Promise<string>} 文件 ID（路径最后一段）
 */
export async function uploadToCatbox(content, expiration = '1h', filename = 'fount_upload.txt') {
	const formData = new FormData()
	formData.append('reqtype', 'fileupload')
	formData.append('time', expiration)
	formData.append('fileToUpload', new Blob([content]), filename)

	const response = await fetch(CATBOX_API_URL, {
		method: 'POST',
		body: formData,
	})

	if (!response.ok)
		throw new Error(`Failed to upload to Catbox: ${await response.text()}`)

	const fileUrl = await response.text()
	return new URL(fileUrl).pathname.substring(1)
}

/**
 * 从 Litterbox 下载文本。
 * @param {string} fileId 文件 ID
 * @returns {Promise<string>} 文件内容
 */
export async function downloadFromCatbox(fileId) {
	const resp = await fetch(`${CATBOX_SERVE_HOST}/${fileId}`)
	if (!resp.ok)
		throw new Error(`Failed to fetch data from Catbox: ${resp.statusText}`)
	return await resp.text()
}
