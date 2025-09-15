async function fetchDataWithHandling(url, options = {}) {
	const response = await fetch(url, options)
	if (!response.ok) {
		const data = await response.json().catch(() => null)
		throw new Error(data?.error || `HTTP Error! status: ${response.status}`)
	}
	return response.json()
}

export async function getTemplates() {
	return fetchDataWithHandling('/api/shells/easynew/templates')
}

export async function getTemplateHtml(templateName) {
	return fetchDataWithHandling(`/api/shells/easynew/template-html?templateName=${encodeURIComponent(templateName)}`)
}

export async function createPart(formData) {
	return fetchDataWithHandling('/api/shells/easynew/create', {
		method: 'POST',
		body: formData,
	})
}
