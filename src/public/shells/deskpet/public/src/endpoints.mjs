async function fetchDataWithHandling(url, options = {}) {
	const response = await fetch(url, options)
	if (!response.ok) {
		const data = await response.json().catch(() => null)
		throw new Error(data?.message || `HTTP error! status: ${response.status}`)
	}
	return response.json()
}

export async function getRunningPetList() {
	return fetchDataWithHandling('/api/shells/deskpet/getrunningpetlist')
}

export async function startPet(charname) {
	return fetchDataWithHandling('/api/shells/deskpet/start', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ charname }),
	})
}

export async function stopPet(charname) {
	return fetchDataWithHandling('/api/shells/deskpet/stop', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ charname }),
	})
}
