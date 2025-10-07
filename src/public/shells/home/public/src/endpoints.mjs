export async function getHomeRegistry() {
	return fetch('/api/shells/home/gethomeregistry').then(async response => {
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
