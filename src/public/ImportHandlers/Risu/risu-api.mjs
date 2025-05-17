import { Buffer } from 'node:buffer'

const RISU_API_PNG_DOWNLOAD_URL = 'https://realm.risuai.net/api/v1/download/png-v3/'
// 根据 Risu 源码，他们也有 dynamic 下载，可能会返回 charx
const RISU_API_DYNAMIC_DOWNLOAD_URL = 'https://realm.risuai.net/api/v1/download/dynamic/'


/**
 * 从 Risu Realm 下载角色卡片 (优先尝试 dynamic 获取 charx，失败则尝试 png-v3)
 * @param {string} uuid 角色 UUID
 * @returns {Promise<{buffer: Buffer, filename: string, contentType: string}>}
 */
export async function downloadRisuCard(uuid) {
	let response
	let urlToTry
	let contentType
	let filename

	try {
		urlToTry = `${RISU_API_DYNAMIC_DOWNLOAD_URL}${uuid}?cors=true`
		response = await fetch(urlToTry, { headers: { 'x-risu-api-version': '4' } })
		contentType = response.headers.get('content-type')

		if (response.ok && (contentType?.includes('application/zip') || contentType?.includes('application/charx')))
			filename = `${uuid}.charx`
		else if (response.ok && contentType?.includes('image/png'))
			filename = `${uuid}.png`
		else
			// 如果 dynamic 下载失败或类型不对，尝试 png-v3
			throw new Error(`Dynamic download failed or returned unexpected type: ${contentType}`)

	} catch (err) {
		console.warn(`Dynamic download for ${uuid} failed, trying PNGv3. Error: ${err.message}`)
		urlToTry = `${RISU_API_PNG_DOWNLOAD_URL}${uuid}?non_commercial=true`
		response = await fetch(urlToTry)
		contentType = response.headers.get('content-type')
		if (!response.ok || !contentType?.includes('image/png'))
			throw new Error(`Failed to download Risu card PNG for ${uuid} from ${urlToTry}. Status: ${response.status}, Type: ${contentType}`)

		filename = `${uuid}.png`
	}

	const arrayBuffer = await response.arrayBuffer()
	return { buffer: Buffer.from(arrayBuffer), filename, contentType }
}

// 你也可以添加从其他 Risu 相关 URL 下载的函数，如果需要
// 例如，直接下载资源文件的函数
/**
 * 从给定的 URL 下载资源
 * @param {string} url
 * @returns {Promise<Buffer>}
 */
export async function downloadAsset(url) {
	if (!url.startsWith('http'))
		throw new Error(`Invalid URL for downloadAsset: ${url}`)

	const response = await fetch(url)
	if (!response.ok)
		throw new Error(`Failed to download asset from ${url}. Status: ${response.status}`)

	const arrayBuffer = await response.arrayBuffer()
	return Buffer.from(arrayBuffer)
}
