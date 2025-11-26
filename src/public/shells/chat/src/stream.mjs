/**
 * 生成两个字符串之间的文本差异切片。
 * @param {string} oldContent - 旧文本内容。
 * @param {string} newContent - 新文本内容。
 * @returns {Array<object>} - 包含文本差异切片的数组。
 */
function generateTextDiff(oldContent = '', newContent = '') {
	const slices = []

	// 情况1: 完全相等
	if (oldContent === newContent) return slices

	// 情况2: 纯追加 (最常见，性能最优)
	if (newContent.startsWith(oldContent)) {
		slices.push({
			type: 'append',
			add: {
				content: newContent.slice(oldContent.length)
			}
		})
		return slices
	}

	// 情况3: 内容重写 (例如 "Thinking..." -> "Result")
	// 寻找公共前缀，仅重写尾部，减少闪烁
	let i = 0
	while (i < oldContent.length && i < newContent.length && oldContent[i] === newContent[i])
		i++

	slices.push({
		type: 'rewrite_tail',
		index: i,
		content: newContent.slice(i)
	})

	return slices
}

/**
 * 生成两个消息对象之间的差异切片，包括文本和文件。
 * @param {object} oldMessage - 旧消息对象。
 * @param {object} newMessage - 新消息对象。
 * @returns {Array<object>} - 包含文本和文件差异切片的数组。
 */
export function generateDiff(oldMessage, newMessage) {
	const oldContent = oldMessage?.content || ''
	const newContent = newMessage?.content || ''
	const textSlices = generateTextDiff(oldContent, newContent)

	const fileSlices = []
	const oldFiles = oldMessage?.files || []
	const newFiles = newMessage?.files || []

	if (oldFiles.length !== newFiles.length || oldFiles.some((file, i) => file.name !== newFiles[i]?.name))
		fileSlices.push({
			type: 'set_files',
			files: newFiles
		})

	return [...textSlices, ...fileSlices]
}

