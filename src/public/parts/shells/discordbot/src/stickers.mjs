/**
 * Discord application emoji 解析（char 声明 emojiName，壳层负责创建/查找）。
 * @param {import('npm:discord.js').Client} client Discord 客户端
 * @param {string} emojiName emoji 名
 * @param {Buffer} fileBuffer 图片字节
 * @returns {Promise<string>} Discord emoji token
 */
export async function resolveDiscordStickerEmoji(client, emojiName, fileBuffer) {
	if (!client?.application) throw new Error('Discord application unavailable')
	const emojis = await client.application.emojis.fetch()
	let emoji = emojis.find(row => row.name === emojiName)
	if (!emoji)
		emoji = await client.application.emojis.create({ attachment: fileBuffer, name: emojiName })
	return `<:${emoji.name}:${emoji.id}>`
}

/**
 * @param {Record<string, { emojiName: string }>} stickerMap char 贴纸映射
 * @param {string} fileName 文件名
 * @returns {{ emojiName: string } | null} 命中的贴纸映射
 */
function lookupDiscordStickerMapping(stickerMap, fileName) {
	if (!stickerMap || !fileName) return null
	if (stickerMap[fileName]) return stickerMap[fileName]
	const base = fileName.replace(/\.avif$/i, '')
	return stickerMap[`${base}.avif`] || stickerMap[base] || null
}

/**
 * 按 char 声明的 stickers 映射解析出站文件。
 * @param {import('npm:discord.js').Client} client Discord 客户端
 * @param {Record<string, { emojiName: string }>} stickerMap char 贴纸映射
 * @param {Array<{ name?: string, buffer?: Buffer }>} files 出站文件
 * @returns {Promise<{ emojiTokens: string[], attachmentFiles: typeof files }>} emoji token 与剩余附件
 */
export async function resolveOutboundDiscordStickers(client, stickerMap, files) {
	const emojiTokens = []
	/** @type {typeof files} */
	const attachmentFiles = []
	for (const file of files || []) {
		const baseName = String(file.name || '')
		const mapping = lookupDiscordStickerMapping(stickerMap, baseName)
		if (mapping?.emojiName && file.buffer?.byteLength) {
			emojiTokens.push(await resolveDiscordStickerEmoji(client, mapping.emojiName, file.buffer))
			continue
		}
		attachmentFiles.push(file)
	}
	return { emojiTokens, attachmentFiles }
}
