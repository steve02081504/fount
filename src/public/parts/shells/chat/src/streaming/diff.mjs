/**
 * 【文件】src/streaming/diff.mjs
 * 【职责】在流式预览或 WS 增量推送时，计算相邻消息快照之间的最小差异切片，减少重复传输全文。
 * 【原理】文本字段优先检测前缀追加（append）；否则找最长公共前缀后 emit rewrite_tail；content 与 content_for_show 可合并为单条 append；files 仅在长度或 name 变化时 emit set_files。
 * 【数据结构】diff slice：`{ type: 'append', add }`、`{ type: 'rewrite_tail', index, content, field? }`、`{ type: 'set_files', files }`。
 * 【关联】被 session 广播/前端 MessagePipeline 等增量更新路径 import；无下游模块依赖。
 */
/**
 * @param {string} oldContent 旧文本
 * @param {string} newContent 新文本
 * @returns {Array<object>} 文本差异切片
 */
function generateTextDiff(oldContent = '', newContent = '') {
	if (oldContent === newContent) return []
	if (newContent.startsWith(oldContent))
		return [{ type: 'append', add: { content: newContent.slice(oldContent.length) } }]

	let index = 0
	while (index < oldContent.length && index < newContent.length && oldContent[index] === newContent[index])
		index++

	return [{ type: 'rewrite_tail', index, content: newContent.slice(index) }]
}

/**
 * 生成两个消息对象之间的差异切片（content / content_for_show / files）。
 * @param {object} oldMessage 旧消息
 * @param {object} newMessage 新消息
 * @returns {Array<object>} 差异切片
 */
export function generateDiff(oldMessage, newMessage) {
	const appendAdd = {}
	const separateSlices = []

	/**
	 * @param {string} field 字段名
	 * @param {string} oldValue 旧文本
	 * @param {string} newValue 新文本
	 * @returns {void}
	 */
	function pushTextDiffs(field, oldValue, newValue) {
		if (oldValue === newValue) return
		for (const slice of generateTextDiff(oldValue, newValue))
			if (slice.type === 'append') appendAdd[field] = slice.add.content
			else separateSlices.push({ ...slice, field })
	}

	pushTextDiffs('content', oldMessage?.content ?? '', newMessage?.content ?? '')
	pushTextDiffs(
		'content_for_show',
		oldMessage?.content_for_show ?? '',
		newMessage?.content_for_show ?? '',
	)

	const textSlices = Object.keys(appendAdd).length
		? [{ type: 'append', add: appendAdd }]
		: []

	const oldFiles = oldMessage?.files || []
	const newFiles = newMessage?.files || []
	const fileSlices = oldFiles.length !== newFiles.length
		|| oldFiles.some((file, index) => file.name !== newFiles[index]?.name)
		? [{ type: 'set_files', files: newFiles }]
		: []

	return [...textSlices, ...separateSlices, ...fileSlices]
}
