/**
 * @param {object} args GetReply 参数
 * @returns {Promise<object>}
 */
export async function GetReply(args) {
	const memory = args.chat_scoped_char_memory
	if (memory?.fuyanMode) return { content: '嗯嗯！' }
	const platform = args.extension?.bridge?.platform || 'chat'
	return { content: `gentian_shell_contract reply (${platform})` }
}
