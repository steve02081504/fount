/**
 * @param {object} args GetReply 参数
 * @returns {Promise<object>} 角色回复内容
 */
export async function GetReply(args) {
	const memory = args.chat_scoped_char_memory
	if (memory?.fuyanMode) return { content: '嗯嗯！' }
	const platform = args.extension?.bridge?.platform || 'chat'
	return { content: `gentian_shell_contract reply (${platform})` }
}
