import { Buffer } from 'node:buffer'

import { decode as decodeText } from 'npm:png-chunk-text' // SillyTavern 使用的是 'npm:png-chunk-text'
import pngChunksEncode from 'npm:png-chunks-encode'
import pngChunksExtract from 'npm:png-chunks-extract'


/**
 * 从 PNG Buffer 中提取 CCv3 数据和内嵌资源
 * @param {Buffer} pngBuffer
 * @returns {Promise<{card: object, assets: Map<string, Buffer>, image: Buffer, spec: 'ccv3' | 'ccv2' | null}>}
 *          card: 解析后的卡片JSON对象
 *          assets: Map<asset_path, asset_buffer>
 *          image: 清理元数据后的图像Buffer
 *          spec: 检测到的卡片规范版本
 */
export async function extractPngCardData(pngBuffer) {
	const chunks = pngChunksExtract(pngBuffer)
	let card = null
	let spec = null
	const assets = new Map()

	const ccv3Chunk = chunks.find(c => c.name === 'tEXt' && decodeText(c.data).keyword === 'ccv3')
	const ccv2Chunk = chunks.find(c => c.name === 'tEXt' && decodeText(c.data).keyword === 'chara')

	if (ccv3Chunk)
		try {
			const cardJsonString = Buffer.from(decodeText(ccv3Chunk.data).text, 'base64').toString('utf-8')
			card = JSON.parse(cardJsonString)
			spec = 'ccv3'
		} catch (e) {
			console.error('Failed to parse ccv3 chunk:', e)
			// 如果 ccv3 解析失败，尝试 ccv2
		}


	if (!card && ccv2Chunk)  // 如果没有ccv3或ccv3解析失败，尝试ccv2
		try {
			const cardJsonString = Buffer.from(decodeText(ccv2Chunk.data).text, 'base64').toString('utf-8')
			card = JSON.parse(cardJsonString)
			if (card.spec === 'chara_card_v2')  // 确认是 STv2 卡
				spec = 'ccv2'
			else { // 其他基于 chara chunk 的卡片，可能需要进一步判断或标记为未知v2
				spec = 'ccv2_generic'
				console.warn('Found "chara" chunk, but not a standard Tavern V2 spec. Treating as generic V2.')
			}
		} catch (e) {
			console.error('Failed to parse chara (ccv2) chunk:', e)
		}


	if (!card)
		throw new Error('No valid character data found in PNG chunks (ccv3 or chara).')


	const assetChunks = chunks.filter(c => c.name === 'tEXt' && decodeText(c.data).keyword.startsWith('chara-ext-asset_:'))
	for (const chunk of assetChunks) {
		const decoded = decodeText(chunk.data)
		const path = decoded.keyword.substring('chara-ext-asset_:'.length)
		const data = Buffer.from(decoded.text, 'base64')
		assets.set(path, data)
	}

	// 清理PNG元数据以获取纯图像
	const cleanedChunks = chunks.filter(c => {
		if (c.name === 'tEXt') {
			const { keyword } = decodeText(c.data)
			return keyword !== 'ccv3' && keyword !== 'chara' && !keyword.startsWith('chara-ext-asset_:')
		}
		return true
	})
	const image = Buffer.from(pngChunksEncode(cleanedChunks))

	return { card, assets, image, spec }
}
