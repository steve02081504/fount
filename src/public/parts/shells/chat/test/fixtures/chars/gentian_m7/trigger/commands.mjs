/**
 * 契约 fixture：仅保留集成测试需要的复诵 / 自裁命令。
 * @param {object} params 参数
 * @param {string} params.content 消息文本
 * @param {object} params.message Message 对象
 * @param {object} params.client ChatClient
 * @param {string} params.groupId 群 id
 * @param {boolean} params.isFromOwner 是否主人消息
 * @param {string} params.username fount 用户名
 * @returns {Promise<'handled' | 'exit' | 'none'>} 命令处理结果
 */
export async function handleOwnerCommands({
	content, message, client, groupId, isFromOwner, username,
}) {
	if (!isFromOwner) return 'none'

	if (/^龙胆.{0,2}自裁.{0,2}$/.test(content) || /龙胆.*自裁/.test(content)) {
		await message.reply({ content: '啊，咱死了～' })
		const group = await client.group(groupId)
		const bridge = group.bridge
		if (bridge?.platform && bridge?.botname) {
			const { requireBridgeOp } = await import('fount/public/parts/shells/chat/src/chat/bridge/ops.mjs')
			await requireBridgeOp(username, bridge, 'stopSelf')()
		}
		return 'exit'
	}

	const repeatMatch = content.match(/^龙胆.{0,2}复诵.{0,2}\s*(?<backticks>`+)[^\n]*\n(?<repeat_content>[\S\s]*?)\k<backticks>\s*$/)
	if (repeatMatch?.groups?.repeat_content) {
		await message.reply({ content: repeatMatch.groups.repeat_content })
		return 'handled'
	}

	return 'none'
}
