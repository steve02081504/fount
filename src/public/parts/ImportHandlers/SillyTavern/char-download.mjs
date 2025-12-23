import { write } from './data_reader.mjs'

/**
 * 从给定 URL 下载角色卡并返回其缓冲区。
 * @param {string} url - 角色卡的 URL。
 * @returns {Promise<Uint8Array>} - 角色卡的缓冲区。
 * @throws {Error} - 如果 URL 无效或无法下载角色卡。
 */
export async function downloadCharacter(url) {
	const host = getHostFromUrl(url)

	if (host.includes('pygmalion.chat'))
		return downloadPygmalionCharacter(getUuidFromUrl(url))
	else if (host.includes('janitorai'))
		return downloadJannyCharacter(getUuidFromUrl(url))
	else if (host.includes('aicharactercards.com'))
		return downloadAICCCharacter(parseAICC(url))
	else if (host.includes('chub.ai') || host.includes('characterhub.org')) {
		const parsed = parseChubUrl(url)
		if (parsed?.type === 'character')
			return downloadChubCharacter(parsed.id)
		else if (parsed?.type === 'lorebook')
			throw new Error('Lorebook download not supported')
	}
	else if (host.includes('realm.risuai.net'))
		return downloadRisuCharacter(parseRisuUrl(url))
	else if (host.includes('github.com'))
		return downloadGithubCharacter(parseGithubUrl(url))
	else
		return downloadGenericPng(url)
}

/**
 * 从 Chub.ai 下载角色。
 * @param {string} id - 角色 ID。
 * @returns {Promise<ArrayBuffer>} - 角色数据的 ArrayBuffer。
 */
async function downloadChubCharacter(id) {
	const [creatorName, projectName] = id.split('/')
	const result = await fetch(`https://api.chub.ai/api/characters/${creatorName}/${projectName}`, {
		method: 'GET',
		headers: { 'Content-Type': 'application/json', 'User-Agent': 'fount/1.0' },
	})

	if (!result.ok) throw await result.text()

	const metadata = await result.json()
	const downloadUrl = metadata.node?.max_res_url


	const downloadResult = await fetch(downloadUrl)

	if (!downloadResult.ok) throw await downloadResult.text()

	return await downloadResult.arrayBuffer()
}

/**
 * 从 Pygmalion.chat 下载角色。
 * @param {string} id - 角色 ID。
 * @returns {Promise<Uint8Array>} - 角色数据的 Uint8Array。
 */
async function downloadPygmalionCharacter(id) {
	const result = await fetch(`https://server.pygmalion.chat/api/export/character/${id}/v2`)

	if (!result.ok)
		throw new Error(`Pygsite download failed: ${result.status} ${await result.text()}`)


	const jsonData = await result.json()
	const characterData = jsonData?.character

	if (!characterData || !(characterData instanceof Object))
		throw new Error('Pygsite returned invalid character data')


	try {
		const avatarUrl = characterData?.data?.avatar
		if (!avatarUrl)
			throw new Error('Pygsite character does not have an avatar')


		const avatarResult = await fetch(avatarUrl)
		const avatarBuffer = await avatarResult.arrayBuffer()
		return write(new Uint8Array(avatarBuffer), JSON.stringify(characterData))
	}
	catch (e) {
		console.error('Failed to download avatar, using JSON instead', e)
		return new TextEncoder().encode(JSON.stringify(jsonData))
	}
}

/**
 * 解析 Chub.ai URL。
 * @param {string} str - URL 字符串。
 * @returns {{type: 'character' | 'lorebook', id: string} | null} - 解析结果或 null。
 */
function parseChubUrl(str) {
	const match = str.match(/^(?:https?:\/\/(?:www\.)?(?:chub\.ai|characterhub\.org)\/)?(characters|lorebooks)\/(.+)$/i)
	if (match)
		return { type: match[1] === 'characters' ? 'character' : 'lorebook', id: match[2] }

	if (str.match(/^(?:https?:\/\/(?:www\.)?(?:chub\.ai|characterhub\.org))?\/.+$/i))
		return { id: str, type: 'character' }
	return null
}

/**
 * 从 JanitorAI 下载角色。
 * @param {string} uuid - 角色的 UUID。
 * @returns {Promise<ArrayBuffer>} - 角色数据的 ArrayBuffer。
 */
async function downloadJannyCharacter(uuid) {
	const result = await fetch('https://api.jannyai.com/api/v1/download', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ characterId: uuid }),
	})

	if (!result.ok)
		throw new Error(`Janny download failed: ${result.statusText} ${await result.text()}`)


	const downloadResult = await result.json()
	if (downloadResult.status !== 'ok')
		throw new Error(`Janny download failed: ${downloadResult.message}`)


	const imageResult = await fetch(downloadResult.downloadUrl)
	return imageResult.arrayBuffer()
}

/**
 * 从 AICharacterCards.com 下载角色。
 * @param {string} id - 角色 ID。
 * @returns {Promise<ArrayBuffer>} - 角色数据的 ArrayBuffer。
 */
async function downloadAICCCharacter(id) {
	const apiURL = `https://aicharactercards.com/wp-json/pngapi/v1/image/${id}`
	const response = await fetch(apiURL)
	if (!response.ok)
		throw new Error(`AICC download failed: ${response.statusText}`)

	return response.arrayBuffer()
}

/**
 * 解析 AICharacterCards.com URL。
 * @param {string} url - URL 字符串。
 * @returns {string | null} - 解析后的 ID 或 null。
 */
function parseAICC(url) {
	const match = url.match(/^https?:\/\/aicharactercards\.com\/character-cards\/([^/]+)\/([^/]+)\/?$|([^/]+)\/([^/]+)$/)
	return match ? match[1] && match[2] ? `${match[1]}/${match[2]}` : `${match[3]}/${match[4]}` : null
}

/**
 * 下载通用的 PNG 文件。
 * @param {string} url - URL 字符串。
 * @returns {Promise<ArrayBuffer>} - PNG 数据的 ArrayBuffer。
 */
async function downloadGenericPng(url) {
	const response = await fetch(url, { method: 'GET', headers: { Accept: '*/*' } }) // Set Accept header to allow various content types
	if (!response.ok)
		throw new Error(`Generic download failed: ${response.statusText}`)

	return response.arrayBuffer()
}

/**
 * 解析 RisuAI URL。
 * @param {string} url - URL 字符串。
 * @returns {string | null} - 解析后的 UUID 或 null。
 */
function parseRisuUrl(url) {
	const match = url.match(/^https?:\/\/realm\.risuai\.net\/character\/([\da-f-]+)\/?$/i)
	return match ? match[1] : null
}

/**
 * 从 RisuAI 下载角色。
 * @param {string} uuid - 角色的 UUID。
 * @returns {Promise<ArrayBuffer>} - 角色数据的 ArrayBuffer。
 */
async function downloadRisuCharacter(uuid) {
	const result = await fetch(`https://realm.risuai.net/api/v1/download/png-v3/${uuid}?non_commercial=true`)

	if (!result.ok)
		throw new Error(`RisuAI download failed: ${result.status} ${await result.text()}`)

	return result.arrayBuffer()
}

/**
 * 从 URL 中提取 UUID。
 * @param {string} url - URL 字符串。
 * @returns {string | null} - 提取的 UUID 或 null。
 */
function getUuidFromUrl(url) {
	const match = url.match(/[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}/)
	return match ? match[0] : null
}

/**
 * 从 URL 中提取主机名。
 * @param {string} url - URL 字符串。
 * @returns {string} - 主机名。
 */
function getHostFromUrl(url) {
	try {
		return new URL(url).hostname
	}
	catch {
		return ''
	}
}

/**
 * 从 GitHub 下载角色。
 * @param {string} id - 仓库 ID (例如 'owner/repo')。
 * @returns {Promise<ArrayBuffer>} - 角色数据的 ArrayBuffer。
 */
async function downloadGithubCharacter(id) {
	const result = await fetch(`https://api.github.com/repos/${id}/releases/latest`)

	if (!result.ok)
		throw new Error(`GitHub download failed: ${result.status} ${await result.text()}`)


	const json = await result.json()
	const { assets } = json
	const contentTypes = ['image/png', 'image/jpeg', 'image/apng', 'application/json']

	for (const type of contentTypes) {
		const asset = assets.find(asset => asset.content_type === type)
		if (asset)
			return (await fetch(asset.browser_download_url)).arrayBuffer()
	}

	throw new Error('No suitable asset found on GitHub')
}

/**
 * 解析 GitHub URL。
 * @param {string} url - URL 字符串。
 * @returns {string | null} - 解析后的仓库 ID 或 null。
 */
function parseGithubUrl(url) {
	const match = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/i)
	return match ? `${match[1]}/${match[2]}` : null
}
