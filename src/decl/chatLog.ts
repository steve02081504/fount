import { Buffer } from 'node:buffer'

import { chatReply_t } from '../public/parts/shells/chat/decl/chatLog.ts'

/**
 * 最终 AI 源处理的回复预览更新器。
 * @param reply 聊天回复
 */
export type ReplyPreviewUpdater_t = (reply: chatReply_t) => void

/**
 * 角色处理中回复预览更新器（含完整请求上下文）。
 */
export type CharReplyPreviewUpdater_t = (
	args: import('../public/parts/shells/chat/decl/chatLog.ts').chatReplyRequest_t,
	reply: chatReply_t,
) => void

/**
 * 生成选项中的回复预览钩子。
 */
export type GenerationOptions_t = {
	replyPreviewUpdater?: ReplyPreviewUpdater_t
	signal?: AbortSignal
	supported_functions?: {
		markdown?: boolean
		mathjax?: boolean
		html?: boolean
		unsafe_html?: boolean
		files?: boolean
		add_message?: boolean
		fount_i18nkeys?: boolean
		fount_assets?: boolean
		fount_themes?: boolean
	}
	base_result?: {
		content: string
		files: {
			name: string
			mime_type: string
			buffer: Buffer
			description: string
		}[]
		extension?: object
	}
}
