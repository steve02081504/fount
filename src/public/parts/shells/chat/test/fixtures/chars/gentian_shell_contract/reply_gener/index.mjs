import { onMessageProbe } from 'fount/public/parts/shells/chat/test/fixtures/probes/onMessageProbe.mjs'

/**
 * @param {object} args GetReply 参数
 * @returns {Promise<object>} 角色回复内容
 */
export async function GetReply(args) {
	onMessageProbe.replies++
	const memory = args.chat_scoped_char_memory
	if (memory?.fuyanMode) return { content: '嗯嗯！' }
	const platform = args.extension?.bridge?.platform || 'chat'
	return { content: `gentian_shell_contract reply (${platform})` }
}
