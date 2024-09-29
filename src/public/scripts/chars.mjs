export async function getCharList() {
	const response = await fetch('/api/charlist')
	return response.json()
}
export async function getCharDetails(charname) {
	const response = await fetch('/api/chardetails?charname=' + charname, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		}
	})
	return response.json()
}
