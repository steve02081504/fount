import { escapeRegExp } from '../../../../scripts/escape.mjs'
import { geti18n } from '../../../../scripts/i18n.mjs'

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

/**
 * 定义工具调用隐藏器。
 * @param {{start: string|RegExp, end: string|RegExp}[]} toolPairs - 工具对数组。
 * @returns {import('../decl/chatLog.ts').CharReplyPreviewUpdater_t} - 回复预览更新器获取器。
 */
export function defineToolUseBlocks(toolPairs) {
	const pattern = new RegExp(`(${toolPairs.map(pair => {
		const start = pair.start instanceof RegExp ? pair.start.source : escapeRegExp(pair.start)
		const end = pair.end instanceof RegExp ? pair.end.source : escapeRegExp(pair.end)
		return `(?:${start})[\\s\\S]*?(?:(?:${end})|$)`
	}).join('|')})`, 'g')
	return (next) => (args, reply) => {
		let { content } = reply
		content = content.replace(pattern,
			args.supported_functions.html ? `\
<div class="tool-call-placeholder card bg-base-100 shadow-xl">
	<div class="card-body">
	${args.supported_functions.fount_i18nkeys ?
					'<span class="tool-call-placeholder-text" data-i18n="chat.messageView.commonToolCalling"></span>' :
					`<span class="tool-call-placeholder-text">${geti18n('chat.messageView.commonToolCalling')}</span>`
				}
	</div>
</div>
`
				:
				args.supported_functions.markdown ?
					`*[[${geti18n('chat.messageView.commonToolCalling')}]]*` :
					`(${geti18n('chat.messageView.commonToolCalling')})`
		)
		pattern.lastIndex = 0
		next?.(args, { ...reply, content })
	}
}
