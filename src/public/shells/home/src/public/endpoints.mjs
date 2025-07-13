export async function getHomeRegistry() {
	return fetch('/api/shells/home/gethomeregistry')
}
