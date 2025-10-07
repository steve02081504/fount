export async function getPartList(partType) {
	const response = await fetch('/api/getlist/' + partType)
	return response.json()
}
export async function getPartTypes() {
	const response = await fetch('/api/getparttypelist')
	return response.json()
}
export async function getCharList() {
	const response = await fetch('/api/getlist/chars')
	return response.json()
}
export async function getPartDetails(partType, partName) {
	const response = await fetch(`/api/getdetails/${partType}?name=${partName}`)
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
export async function noCacheGetWorldDetails(worldname) {
	const response = await fetch('/api/getdetails/worlds?name=' + worldname + '&nocache=true')
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
export async function noCacheGetPersonaDetails(personaname) {
	const response = await fetch('/api/getdetails/personas?name=' + personaname + '&nocache=true')
	return response.json()
}
export async function setDefaultPart(parttype, partname) {
	return fetch('/api/setdefaultpart', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ parttype, partname }),
	})
}
export async function getDefaultParts() {
	return fetch('/api/getdefaultparts').then(async response => {
		if (response.ok) return response.json()
		else return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	})
}

export async function getAllCachedPartDetails(partType) {
	return fetch(`/api/getallcacheddetails/${partType}`).then(async response => {
		if (response.ok) return response.json()
		else return Promise.reject(Object.assign(new Error(`API request failed with status ${response.status}`), await response.json().catch(() => { }), { response }))
	})
}
