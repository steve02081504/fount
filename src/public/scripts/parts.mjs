export async function getCharList() {
	const response = await fetch('/api/getlist/chars')
	return response.json()
}
export async function getCharDetails(charname) {
	const response = await fetch('/api/getdetails/chars?name=' + charname)
	return response.json()
}
export async function noCacheGetCharDetails(charname) {
	const response = await fetch('/api/getdetails/chars?name=' + charname + '&nocache=true')
	return response.json()
}
export async function getWorldList() {
	const response = await fetch('/api/getlist/worlds')
	return response.json()
}
export async function getWorldDetails(worldname) {
	const response = await fetch('/api/getdetails/worlds?name=' + worldname)
	return response.json()
}
export async function getPersonaList() {
	const response = await fetch('/api/getlist/personas')
	return response.json()
}
export async function getPersonaDetails(personaname) {
	const response = await fetch('/api/getdetails/personas?name=' + personaname)
	return response.json()
}
