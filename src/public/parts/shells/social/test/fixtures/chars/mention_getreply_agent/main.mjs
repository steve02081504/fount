/**
 * 仅 chat.GetReply、无 social.OnMessage；捕获请求身份字段供回归断言。
 */
import { getReplyIdentityProbe } from 'fount/public/parts/shells/social/test/fixtures/probes/getReplyIdentityProbe.mjs'

export default {
	info: {
		'zh-CN': { name: 'Mention fallback agent', avatar: '🤖', description: '', version: '1', author: 'fount', tags: ['test'] },
		'en-US': { name: 'Mention fallback agent', avatar: '🤖', description: '', version: '1', author: 'fount', tags: ['test'] },
	},
	interfaces: {
		chat: {
			/**
			 * @param {import('../../../../../../../../../decl/chatLog.ts').chatReplyRequest_t} req 请求
			 * @returns {Promise<object>} 固定回复
			 */
			GetReply: async req => {
				getReplyIdentityProbe.last = {
					UserUid: req.UserUid,
					CharUid: req.CharUid,
					ReplyToUid: req.ReplyToUid,
					UserCharname: req.UserCharname,
					ReplyToCharname: req.ReplyToCharname,
					chatLogUids: (req.chat_log || []).map(entry => entry.uid),
				}
				return { content: 'mention-getreply-fallback' }
			},
		},
	},
}
