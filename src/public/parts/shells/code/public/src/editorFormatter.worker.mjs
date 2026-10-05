/**
 * 用户安装的浏览器格式化模块，仅在请求格式化时运行。
 * @param {MessageEvent} event - 格式化模块源码与文档。
 * @returns {Promise<void>} 发回结果或错误。
 */
globalThis.onmessage = async event => {
	const { source, document } = event.data
	const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
	try {
		const module = await import(url)
		if (typeof module.format !== 'function') throw new Error('Formatter must export format(document).')
		const text = await module.format(document)
		if (typeof text !== 'string' || text.length > 16 * 1024 * 1024) throw new Error('Formatter must return text smaller than 16 MiB.')
		globalThis.postMessage({ text })
	} catch (error) { globalThis.postMessage({ error: String(error.message || error) }) }
	finally { URL.revokeObjectURL(url) }
}
