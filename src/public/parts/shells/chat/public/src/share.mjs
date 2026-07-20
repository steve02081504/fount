/**
 * 【文件】public/src/share.mjs
 * 【职责】经 Litterbox 临时上传生成外部分享链接（附件过大或外发场景）。
 * 【原理】multipart POST litterbox API，返回短期 URL。
 * 【数据结构】fileBlob、filename、expiration 参数。
 * 【关联】composer 分享菜单；第三方 catbox 服务。
 */
const LITTERBOX_API_URL = 'https://litterbox.catbox.moe/resources/internals/api.php'

/**
 * 创建分享链接。
 * @param {Blob} fileBlob - 文件Blob。
 * @param {string} filename - 文件名。
 * @param {string} expiration - 过期时间。
 * @returns {Promise<string>} - 分享链接。
 */
export async function createShareLink(fileBlob, filename, expiration) {
	const formData = new FormData()
	formData.append('reqtype', 'fileupload')
	formData.append('time', expiration)
	formData.append('fileToUpload', fileBlob, filename)

	const response = await fetch(LITTERBOX_API_URL, {
		method: 'POST',
		body: formData,
	})

	if (!response.ok)
		throw new Error(`Failed to upload to litterbox: ${response.statusText}`)

	return await response.text()
}
