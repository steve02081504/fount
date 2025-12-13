/**
 * URL 参数传输工具模块
 * 处理 URL 参数的传输，支持 URL、剪贴板和 Catbox 网盘
 * 当 URL 过长时自动使用备选方案
 */

const CATBOX_API_URL = 'https://litterbox.catbox.moe/resources/internals/api.php'
const MAX_URL_LENGTH = 65536

/**
 * 将数据上传到 Catbox 并返回文件 ID。
 * @param {string} content 要上传的内容。
 * @param {string} expiration 文件的过期时间（例如，"1h"、"24h"）。
 * @returns {Promise<string>} 文件 ID（即 catbox 上的文件名）。
 */
async function uploadToCatbox(content, expiration = '1h') {
	const formData = new FormData()
	formData.append('reqtype', 'fileupload')
	formData.append('time', expiration)
	formData.append('fileToUpload', new Blob([content]), 'fount_params.json')

	const response = await fetch(CATBOX_API_URL, {
		method: 'POST',
		body: formData,
	})

	if (!response.ok)
		throw new Error(`Failed to upload to Catbox: ${await response.text()}`)

	const fileUrl = await response.text()
	// The response is the full URL, e.g., https://litter.catbox.moe/abcdef
	// The fileId is the part after the last slash.
	return new URL(fileUrl).pathname.substring(1)
}

/**
 * 从 Catbox 下载数据。
 * @param {string} fileId 文件 ID。
 * @returns {Promise<string>} 数据内容。
 */
async function downloadFromCatbox(fileId) {
	const resp = await fetch(`https://litter.catbox.moe/${fileId}`)
	if (!resp.ok)
		throw new Error(`Failed to fetch data from Catbox: ${resp.statusText}`)
	return await resp.text()
}

/**
 * 为 URL 参数执行传输策略并修改目标 URL。
 * 它会检查 URL 长度，如果超过限制则尝试剪贴板，然后是 Catbox。
 * @param {URL} targetUrl 目标 URL 对象，将被修改。
 * @param {URLSearchParams} params URL 参数对象。
 * @returns {Promise<URL>} 修改后的目标 URL。
 */
export async function applyUrlParamsTransferStrategy(targetUrl, params) {
	// 先尝试直接使用 URL 参数
	targetUrl.search = params.toString()

	// 检查 URL 长度
	if (targetUrl.href.length <= MAX_URL_LENGTH) return targetUrl

	// URL 太长，将参数序列化为 JSON
	const paramsJson = JSON.stringify(Object.fromEntries(params))

	// 1. 尝试使用剪贴板
	try {
		await navigator.clipboard.writeText(paramsJson)
		targetUrl.search = new URLSearchParams({ paramsFrom: 'clipboard' }).toString()
		console.log('URL parameters copied to clipboard for transfer.')
		return targetUrl
	}
	catch (e) {
		console.warn('Clipboard write failed, falling back to Catbox.', e)
	}

	// 2. 回退到 Catbox
	try {
		const fileId = await uploadToCatbox(paramsJson, '1h')
		targetUrl.search = new URLSearchParams({ paramsFileId: fileId }).toString()
		console.log(`URL parameters uploaded to Catbox with fileId: ${fileId}`)
		return targetUrl
	}
	catch (catboxErr) {
		console.warn('Catbox upload failed, falling back to URL parameter.', catboxErr)
	}

	// 3. 回退到 URL 参数（即使很长）
	targetUrl.search = params.toString()
	console.warn('Using URL parameter despite length exceeding limit.')
	return targetUrl
}

/**
 * 从源检索 URL 参数。
 * @param {URLSearchParams} currentParams 当前的 URL 参数。
 * @returns {Promise<URLSearchParams>} 检索到的 URL 参数。
 */
export async function retrieveUrlParams(currentParams) {
	const fileId = currentParams.get('paramsFileId')
	const from = currentParams.get('paramsFrom')

	let paramsJson = null

	// 1. 从 Catbox 文件读取
	if (fileId) try {
		paramsJson = await downloadFromCatbox(fileId)
		console.log('URL parameters retrieved from Catbox.')
	}
	catch (e) {
		console.warn('Failed to retrieve parameters from Catbox:', e)
	}

	// 2. 从剪贴板读取
	if (!paramsJson && from === 'clipboard')
		try {
			paramsJson = await navigator.clipboard.readText()
			if (paramsJson) console.log('URL parameters retrieved from clipboard.')
		}
		catch (e) {
			console.warn('Clipboard read failed.', e)
		}

	// 3. 如果成功检索到参数，解析并返回
	if (paramsJson) try {
		const paramsObj = JSON.parse(paramsJson)
		return new URLSearchParams(paramsObj)
	}
	catch (e) {
		console.warn('Failed to parse retrieved parameters:', e)
	}

	// 4. 回退：返回当前参数（移除传输相关的参数）
	currentParams.delete('paramsFileId')
	currentParams.delete('paramsFrom')
	return currentParams
}
