import { Buffer } from 'node:buffer'

import { decodeRPack } from './rpack.mjs'

/**
 * 解析 .risum 模块缓冲区。
 * @param {Buffer} moduleBuffer module bytes
 * @returns {{moduleDef: object, assetsData: Buffer[]}|null} parsed module or null
 */
export function parseRisuModule(moduleBuffer) {
	try {
		let offset = 0
		/**
		 * 读取一个字节。
		 * @returns {number} byte
		 */
		const readByte = () => moduleBuffer.readUInt8(offset++)
		/**
		 * 读取小端 u32 长度。
		 * @returns {number} length
		 */
		const readLength = () => {
			const length = moduleBuffer.readUInt32LE(offset)
			offset += 4
			return length
		}
		/**
		 * 读取定长切片。
		 * @param {number} length length
		 * @returns {Buffer} slice
		 */
		const readData = length => {
			if (offset + length > moduleBuffer.length)
				throw new Error(`Insufficient module data: need ${length} bytes at ${offset}`)
			const data = moduleBuffer.subarray(offset, offset + length)
			offset += length
			return data
		}

		if (readByte() !== 111) throw new Error('Invalid module magic number')
		readByte() // version; Risu uses 0

		const mainLength = readLength()
		const mainDataPacked = readData(mainLength)
		const mainJson = JSON.parse(new TextDecoder().decode(decodeRPack(mainDataPacked)))

		if (mainJson.type !== 'risuModule') throw new Error(`Invalid module type in metadata: ${mainJson.type}`)

		const moduleDef = mainJson.module
		/** @type {Buffer[]} */
		const assetsData = []
		const expectedAssetCount = moduleDef.assets?.length || 0

		for (let assetIndex = 0; assetIndex < expectedAssetCount; assetIndex++) {
			const mark = readByte()
			if (mark !== 1) throw new Error(`Invalid asset mark: ${mark} for asset ${assetIndex}`)

			const assetLength = readLength()
			const assetDataPacked = readData(assetLength)
			assetsData.push(Buffer.from(decodeRPack(assetDataPacked)))
		}

		return { moduleDef, assetsData }
	}
	catch {
		return null
	}
}
