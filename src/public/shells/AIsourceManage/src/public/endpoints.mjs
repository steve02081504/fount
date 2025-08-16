export async function getConfigTemplate(generatorName) {
	const response = await fetch(`/api/shells/AIsourceManage/getConfigTemplate?${new URLSearchParams({ generator: generatorName })}`)
	return response.json()
}

export async function getConfigDisplay(generatorName) {
	if (!generatorName) return { html: '', js: '' }
	const response = await fetch(`/api/shells/AIsourceManage/getConfigDisplay?${new URLSearchParams({ generator: generatorName })}`)
	return response.json()
}

export async function getAIFile(AISourceFile) {
	const response = await fetch(`/api/shells/AIsourceManage/getfile?${new URLSearchParams({ AISourceFile })}`)
	return response.json()
}

export async function setAIFile(AISourceFile, data) {
	const response = await fetch('/api/shells/AIsourceManage/setfile', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ AISourceFile, data }),
	})
	return response.json()
}

export async function deleteAIFile(AISourceFile) {
	const response = await fetch('/api/shells/AIsourceManage/deletefile', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ AISourceFile }),
	})
	return response.json()
}

export async function addAIFile(AISourceFile) {
	const response = await fetch('/api/shells/AIsourceManage/addfile', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ AISourceFile }),
	})
	return response.json()
}
