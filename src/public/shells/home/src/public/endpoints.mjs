export async function getHomeRegistry() {
	return fetch('/api/shells/home/gethomeregistry').then(response => {
		if (response.ok)
			return response.json()
		else
			return Promise.reject(response.json())
	})
}
