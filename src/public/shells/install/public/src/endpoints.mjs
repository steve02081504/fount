/**
 * 安装 shell 的客户端 API 端点。
 */

/**
 * 导入文件。
 * @param {FormData} formData - 表单数据。
 * @returns {Promise<Response>} - 响应。
 */
export async function importFiles(formData) {
	return fetch('/api/shells/install/file', {
		method: 'POST',
		body: formData,
	})
}

/**
 * 导入文本。
 * @param {string} text - 文本。
 * @returns {Promise<Response>} - 响应。
 */
export async function importText(text) {
	return fetch('/api/shells/install/text', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ text }),
	})
}

/**
 * 卸载部件。
 * @param {string} parttype - 部件类型。
 * @param {string} partname - 部件名称。
 * @returns {Promise<Response>} - 响应。
 */
export async function uninstallPart(parttype, partname) {
	return fetch('/api/shells/install/uninstall', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ parttype, partname }),
	})
}
