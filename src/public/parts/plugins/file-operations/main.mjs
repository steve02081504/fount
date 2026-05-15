import {
	defineToolUseBlocks,
	getChatI18n,
	inferCodeLanguageFromPath,
	renderMarkdownCodeBlock
} from '../../shells/chat/src/stream.mjs'

import { fileOperationsReplyHandler } from './handler.mjs'
import { getFileOperationsPrompt } from './prompt.mjs'

const { info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * 渲染“按目标文件高亮 + 标题”的代码块。
 * @param {object} args - 预览更新参数。
 * @param {string} filepath - 文件路径。
 * @param {string} content - 要展示的内容。
 * @param {'chat.messageView.toolReadingFilepath'|'chat.messageView.toolReplacingFilepath'|'chat.messageView.toolOverridingFilepath'} titleKey - 标题 i18n 键。
 * @returns {string} 渲染后的 Markdown 代码块。
 */
function renderFileOperationCodeBlock(args, filepath, content, titleKey) {
	const lang = inferCodeLanguageFromPath(filepath)
	const title = getChatI18n(args, titleKey, { filepath })
	return renderMarkdownCodeBlock(content, { lang, title })
}

/**
 * 将 <view-file> 中的路径列表渲染为分段代码块。
 * @param {string} content - 标签内容。
 * @param {object} args - 预览更新参数。
 * @returns {string} 渲染结果。
 */
function renderViewFileBlock(content, args) {
	const paths = content
		.split('\n')
		.map(x => x.trim())
		.filter(Boolean)
	if (!paths.length) return content
	return paths.map(filepath =>
		renderFileOperationCodeBlock(args, filepath, filepath, 'chat.messageView.toolReadingFilepath')
	).join('\n\n')
}

/**
 * 渲染 <replace-file> 内容，按每个目标文件分段展示。
 * @param {string} content - 标签内主体（不含起止标签）。
 * @param {object} args - 预览更新参数。
 * @returns {string} 渲染结果。
 */
function renderReplaceFileBlock(content, args) {
	const fileBlocks = [...content.matchAll(/<file\s+path="(?<filepath>[^"]+)">(?<filecontent>[\s\S]*?)<\/file>/g)]
	if (!fileBlocks.length) {
		const filepath = content.match(/<file\s+path="([^"]+)"/)?.[1] || 'unknown'
		return renderFileOperationCodeBlock(args, filepath, content, 'chat.messageView.toolReplacingFilepath')
	}
	return fileBlocks.map(match => {
		const { filepath, filecontent } = match.groups
		return renderFileOperationCodeBlock(args, filepath, filecontent, 'chat.messageView.toolReplacingFilepath')
	}).join('\n\n')
}

/**
 * 渲染 <override-file> 内容。
 * @param {string} content - 标签内主体（不含起止标签）。
 * @param {object} args - 预览更新参数。
 * @param {{ groups: { fountToolStart: string } }} [meta] - `defineToolUseBlocks` 传入的具名组。
 * @returns {string} 渲染结果。
 */
function renderOverrideFileBlock(content, args, meta) {
	const startTag = meta?.groups?.fountToolStart ?? ''
	const filepath = startTag.match(/path="([^"]+)"/)?.[1] || 'unknown'
	return renderFileOperationCodeBlock(args, filepath, content, 'chat.messageView.toolOverridingFilepath')
}

/**
 * 文件操作插件主模块。
 * @returns {import('../../../../../src/decl/pluginAPI.ts').PluginAPI_t} 插件 API 对象。
 */
export default {
	info,
	/**
	 * 插件加载时调用。
	 * @returns {Promise<void>}
	 */
	Load: async () => { },
	/**
	 * 插件卸载时调用。
	 * @returns {Promise<void>}
	 */
	Unload: async () => { },
	interfaces: {
		chat: {
			GetPrompt: getFileOperationsPrompt,
			ReplyHandler: fileOperationsReplyHandler,
			GetReplyPreviewUpdater: defineToolUseBlocks([
				{
					start: '<view-file>',
					end: '</view-file>',
					renderPending: renderViewFileBlock,
				},
				{
					start: '<replace-file>',
					end: '</replace-file>',
					renderPending: renderReplaceFileBlock,
				},
				{
					start: /<override-file[^>]*>/,
					end: '</override-file>',
					renderPending: renderOverrideFileBlock,
				},
			]),
		},
	},
}
