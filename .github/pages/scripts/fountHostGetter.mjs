// URL parameters and localStorage utilities
const urlParams = new URLSearchParams(window.location.search)

export function saveFountHostUrl(hostUrl) {
	localStorage.setItem('fountHostUrl', hostUrl ?? '')
}

async function mappingFountHostUrl(hostUrl) {
	// This function would contain the logic to map and validate the host URL
	// For now, we'll return the hostUrl as-is if it's valid, or null if not
	if (!hostUrl) return null
	
	try {
		new URL(hostUrl)
		return hostUrl
	} catch {
		return null
	}
}

export async function getFountHostUrl(hostUrl = urlParams.get('hostUrl') ?? localStorage.getItem('fountHostUrl')) {
	// Add null check to prevent TypeError when hostUrl is null or undefined
	if (!hostUrl || !hostUrl.startsWith('http')) hostUrl = null
	const result = await mappingFountHostUrl(hostUrl)
	saveFountHostUrl(result)
	return result
}