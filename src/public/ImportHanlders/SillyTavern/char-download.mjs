import { write } from './data_reader.mjs'

/**
 * Downloads a character card from the given URL and returns its buffer.
 * @param {string} url URL of the character card
 * @returns {Promise<Uint8Array>} Buffer of the character card
 * @throws {Error} If the URL is invalid or the character card could not be downloaded
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

	} else if (host.includes('realm.risuai.net'))
		return downloadRisuCharacter(parseRisuUrl(url))
	else if (host.includes('github.com'))
		return downloadGithubCharacter(parseGithubUrl(url))
	else
		return downloadGenericPng(url)
}

async function downloadChubCharacter(id) {
	const result = await fetch('https://api.chub.ai/api/characters/download', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ format: 'tavern', fullPath: id }),
	})

	if (!result.ok)
		throw new Error(`Chub download failed: ${result.status} ${await result.text()}`)

	return result.arrayBuffer()
}

async function downloadPygmalionCharacter(id) {
	const result = await fetch(`https://server.pygmalion.chat/api/export/character/${id}/v2`)

	if (!result.ok)
		throw new Error(`Pygsite download failed: ${result.status} ${await result.text()}`)


	const jsonData = await result.json()
	const characterData = jsonData?.character

	if (!characterData || typeof characterData !== 'object')
		throw new Error('Pygsite returned invalid character data')


	try {
		const avatarUrl = characterData?.data?.avatar
		if (!avatarUrl)
			throw new Error('Pygsite character does not have an avatar')


		const avatarResult = await fetch(avatarUrl)
		const avatarBuffer = await avatarResult.arrayBuffer()
		return write(new Uint8Array(avatarBuffer), JSON.stringify(characterData))
	} catch (e) {
		console.error('Failed to download avatar, using JSON instead', e)
		return new TextEncoder().encode(JSON.stringify(jsonData))
	}
}

function parseChubUrl(str) {
	const match = str.match(/^(?:https?:\/\/(?:www\.)?(?:chub\.ai|characterhub\.org)\/)?(characters|lorebooks)\/(.+)$/i)
	if (match)
		return { type: match[1] === 'characters' ? 'character' : 'lorebook', id: match[2] }

	if (str.match(/^(?:https?:\/\/(?:www\.)?(?:chub\.ai|characterhub\.org))?\/.+$/i))
		return { id: str, type: 'character' }
	return null
}

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

async function downloadAICCCharacter(id) {
	const apiURL = `https://aicharactercards.com/wp-json/pngapi/v1/image/${id}`
	const response = await fetch(apiURL)
	if (!response.ok)
		throw new Error(`AICC download failed: ${response.statusText}`)

	return response.arrayBuffer()
}

function parseAICC(url) {
	const match = url.match(/^https?:\/\/aicharactercards\.com\/character-cards\/([^/]+)\/([^/]+)\/?$|([^/]+)\/([^/]+)$/)
	return match ? match[1] && match[2] ? `${match[1]}/${match[2]}` : `${match[3]}/${match[4]}` : null
}

async function downloadGenericPng(url) {
	const response = await fetch(url, { method: 'GET', headers: { 'Accept': '*/*' }}) // Set Accept header to allow various content types
	if (!response.ok)
		throw new Error(`Generic download failed: ${response.statusText}`)

	return response.arrayBuffer()
}

function parseRisuUrl(url) {
	const match = url.match(/^https?:\/\/realm\.risuai\.net\/character\/([\da-f-]+)\/?$/i)
	return match ? match[1] : null
}

async function downloadRisuCharacter(uuid) {
	const result = await fetch(`https://realm.risuai.net/api/v1/download/png-v3/${uuid}?non_commercial=true`)

	if (!result.ok)
		throw new Error(`RisuAI download failed: ${result.status} ${await result.text()}`)


	return result.arrayBuffer()
}

function getUuidFromUrl(url) {
	const match = url.match(/[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}/)
	return match ? match[0] : null
}

function getHostFromUrl(url) {
	try {
		return new URL(url).hostname
	} catch {
		return ''
	}
}

async function downloadGithubCharacter(id) {
	const result = await fetch(`https://api.github.com/repos/${id}/releases/latest`)

	if (!result.ok)
		throw new Error(`GitHub download failed: ${result.status} ${await result.text()}`)


	const json = await result.json()
	const assets = json.assets
	const contentTypes = ['image/png', 'image/jpeg', 'image/apng', 'application/json']

	for (const type of contentTypes) {
		const asset = assets.find(asset => asset.content_type === type)
		if (asset)
			return (await fetch(asset.browser_download_url)).arrayBuffer()

	}

	throw new Error('No suitable asset found on GitHub')
}

function parseGithubUrl(url) {
	const match = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/i)
	return match ? `${match[1]}/${match[2]}` : null
}
