export async function getCharList() {
	const response = await fetch('/api/getlist/chars')
	return response.json()
}
export async function getCharDetails(charname) {
	const response = await fetch('/api/getdetails/chars?name=' + charname)
	return response.json()
}
