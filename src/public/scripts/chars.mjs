export async function getCharList() {
	const response = await fetch('/api/getlist/chars')
	return response.json()
}
export async function getCharDetails(charname) {
	const response = await fetch('/api/getdetails/chars?name=' + charname, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		}
	})
	return response.json()
}
