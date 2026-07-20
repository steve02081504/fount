/**
 * URL 参数传输工具模块
 * 处理 URL 参数的传输，支持 URL、剪贴板和 Catbox 网盘
 * 当 URL 过长时自动使用备选方案
 */

import { downloadFromCatbox, uploadToCatbox } from './catbox.mjs'

const MAX_URL_LENGTH = 65536

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

	// 1. 尝试使用剪贴板；成功时顺带上传 Catbox 作为读失败时的持久回退
	try {
		await navigator.clipboard.writeText(paramsJson)
		const handoff = new URLSearchParams({ paramsFrom: 'clipboard' })
		try {
			const fileId = await uploadToCatbox(paramsJson, '1h', 'fount_params.json')
			handoff.set('paramsFileId', fileId)
		}
		catch (catboxErr) {
			console.warn('Catbox backup upload failed after clipboard write.', catboxErr)
		}
		targetUrl.search = handoff.toString()
		console.log('URL parameters copied to clipboard for transfer.')
		return targetUrl
	}
	catch (e) {
		console.warn('Clipboard write failed, falling back to Catbox.', e)
	}

	// 2. 回退到 Catbox
	try {
		const fileId = await uploadToCatbox(paramsJson, '1h', 'fount_params.json')
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

	// 1. 剪贴板优先（成功路径不变）；非 JSON 内容走 catch，不阻断 Catbox 回退
	if (from === 'clipboard')
		try {
			const text = await navigator.clipboard.readText()
			JSON.parse(text)
			paramsJson = text
			console.log('URL parameters retrieved from clipboard.')
		}
		catch (e) {
			console.warn('Clipboard read failed, trying persisted handoff.', e)
		}

	// 2. Catbox（含剪贴板失败后的备份，或仅 Catbox 传输）
	if (!paramsJson && fileId) try {
		paramsJson = await downloadFromCatbox(fileId)
		console.log('URL parameters retrieved from Catbox.')
	}
	catch (e) {
		console.warn('Failed to retrieve parameters from Catbox:', e)
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
