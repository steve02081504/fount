/**
 * 获取文件。
 * @param {string} hash - 文件哈希。
 * @returns {Promise<ArrayBuffer>} - 文件内容。
 */
export async function getfile(hash) {
	if (hash.startsWith('file:')) hash = hash.slice(5)
	return fetch('/api/parts/shells:chat/getfile?hash=' + hash).then(res => res.arrayBuffer())
}
