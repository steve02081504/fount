/**
 * 聊天元数据工厂（新建会话默认部件）。
 */
import { getAllDefaultParts, getAnyDefaultPart, loadPart } from '../../../../../../../server/parts_loader.mjs'

/**
 * 创建带默认人格、世界与插件的新聊天元数据。
 * @param {string} username 聊天所有者
 * @returns {Promise<import('./models.mjs').chatMetadata_t>} 新元数据实例
 */
export async function createNewChatMetadata(username) {
	const { chatMetadata_t } = await import('./models.mjs')
	const metadata = new chatMetadata_t(username)

	metadata.LastTimeSlice.player_id = getAnyDefaultPart(username, 'personas')
	if (metadata.LastTimeSlice.player_id)
		metadata.LastTimeSlice.player = await loadPart(username, 'personas/' + metadata.LastTimeSlice.player_id)

	metadata.LastTimeSlice.world_id = getAnyDefaultPart(username, 'worlds')
	if (metadata.LastTimeSlice.world_id)
		metadata.LastTimeSlice.world = await loadPart(username, 'worlds/' + metadata.LastTimeSlice.world_id)

	metadata.LastTimeSlice.plugins = Object.fromEntries(await Promise.all(
		getAllDefaultParts(username, 'plugins').map(async plugin => [
			plugin,
			await loadPart(username, 'plugins/' + plugin),
		]),
	))

	return metadata
}
