export async function getConfigTemplate(generatorName) {
	return fetch(`/api/shells/AIsourceManage/getConfigTemplate?${new URLSearchParams({ generator: generatorName })}`)
}

export async function getAIFile(AISourceFile) {
	return fetch(`/api/shells/AIsourceManage/getfile?${new URLSearchParams({ AISourceFile })}`)
}

export async function setAIFile(AISourceFile, data) {
	return fetch('/api/shells/AIsourceManage/setfile', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ AISourceFile, data }),
	})
}

export async function deleteAIFile(AISourceFile) {
	return fetch('/api/shells/AIsourceManage/deletefile', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ AISourceFile }),
	})
}

export async function addAIFile(AISourceFile) {
	return fetch('/api/shells/AIsourceManage/addfile', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ AISourceFile }),
	})
}
