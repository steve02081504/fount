export async function getfile(hash) {
	if (hash.startsWith('file:')) hash = hash.slice(5)
	return fetch('/api/shells/chat/getfile?hash=' + hash).then(res => res.arrayBuffer())
}
