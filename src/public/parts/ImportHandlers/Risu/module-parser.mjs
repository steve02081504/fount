import { Buffer } from 'node:buffer'

import { decodeRPack } from './rpack.mjs'

/**
 * 解析 .risum 模块缓冲区。
 * @param {Buffer} moduleBuffer module bytes
 * @returns {{moduleDef: object, assetsData: Buffer[]}|null} parsed module or null
 */
export function parseRisuModule(moduleBuffer) {
	try {
		let pos = 0
		/**
		 * 读取一个字节。
		 * @returns {number} byte
		 */
		const readByte = () => moduleBuffer.readUInt8(pos++)
		/**
		 * 读取小端 u32 长度。
		 * @returns {number} length
		 */
		const readLength = () => {
			const len = moduleBuffer.readUInt32LE(pos)
			pos += 4
			return len
		}
		/**
		 * 读取定长切片。
		 * @param {number} len length
		 * @returns {Buffer} slice
		 */
		const readData = len => {
			const data = moduleBuffer.subarray(pos, pos + len)
			pos += len
			return data
		}

		if (readByte() !== 111) throw new Error('Invalid module magic number')
		readByte() // version; Risu uses 0

		const mainLen = readLength()
		const mainDataPacked = readData(mainLen)
		const mainJson = JSON.parse(new TextDecoder().decode(decodeRPack(mainDataPacked)))

		if (mainJson.type !== 'risuModule') throw new Error(`Invalid module type in metadata: ${mainJson.type}`)

		const moduleDef = mainJson.module
		/** @type {Buffer[]} */
		const assetsData = []
		const expectedAssetCount = moduleDef.assets?.length || 0

		for (let i = 0; i < expectedAssetCount; i++) {
			if (pos >= moduleBuffer.length) break
			const mark = readByte()
			if (!mark) break
			if (mark !== 1) throw new Error(`Invalid asset mark: ${mark} for asset ${i}`)

			const assetLen = readLength()
			const assetDataPacked = readData(assetLen)
			assetsData.push(Buffer.from(decodeRPack(assetDataPacked)))
		}

		return { moduleDef, assetsData }
	}
	catch {
		return null
	}
}
