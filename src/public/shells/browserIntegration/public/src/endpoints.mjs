async function callApi(endpoint, method = 'POST', body) {
	const response = await fetch(`/api/shells/browserIntegration/${endpoint}`, {
		method,
		headers: { 'Content-Type': 'application/json' },
		body: body ? JSON.stringify(body) : undefined,
	})
	const contentType = response.headers.get('content-type')
	if (contentType && contentType.indexOf('application/json') !== -1)
		return response.json()
	else {
		const text = await response.text()
		if (!response.ok)
			return { success: false, message: text || response.statusText }

		return { success: true, data: text }
	}
}

export function getConnectedPages() {
	return callApi('pages', 'GET')
}

export function getAutoRunScripts() {
	return callApi('autorun-scripts', 'GET')
}

export function addAutoRunScript(scriptData) {
	return callApi('autorun-scripts', 'POST', scriptData)
}

export function deleteAutoRunScript(id) {
	return callApi(`autorun-scripts/${id}`, 'DELETE')
}
