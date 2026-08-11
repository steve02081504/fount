/**
 * 把已有行上的本地 `content.files[].buffer` 合并进新行（按 fileId，其次 name+mime）。
 * @param {object | undefined} previous 已有行
 * @param {object} next 入站行
 * @returns {object} 可能带本地 buffer 的行
 */
export function retainLocalAttachmentBuffers(previous, next) {
	const prevFiles = previous?.content?.files
	const nextFiles = next?.content?.files
	if (!prevFiles?.length || !nextFiles?.length) return next
	/** @type {Map<string, { buffer: unknown, nameMimeKey: string }>} */
	const byId = new Map()
	/** @type {Map<string, unknown[]>} */
	const byNameMime = new Map()
	for (const file of prevFiles) {
		if (!file.buffer) continue
		const nameMimeKey = `${file.name || ''}\0${file.mime_type || ''}`
		if (file.fileId) byId.set(file.fileId, { buffer: file.buffer, nameMimeKey })
		const queue = byNameMime.get(nameMimeKey)
		if (queue) queue.push(file.buffer)
		else byNameMime.set(nameMimeKey, [file.buffer])
	}
	return {
		...next,
		content: {
			...next.content,
			files: nextFiles.map(file => {
				if (file.buffer) return file
				if (file.fileId) {
					const hit = byId.get(file.fileId)
					if (hit) {
						byId.delete(file.fileId)
						const queue = byNameMime.get(hit.nameMimeKey)
						const idx = queue?.indexOf(hit.buffer) ?? -1
						if (idx >= 0) queue.splice(idx, 1)
						return { ...file, buffer: hit.buffer }
					}
				}
				const buffer = byNameMime.get(`${file.name || ''}\0${file.mime_type || ''}`)?.shift()
				return buffer ? { ...file, buffer } : file
			}),
		},
	}
}
