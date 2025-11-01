import { Buffer } from 'node:buffer'
// 尝试导入 rpack 解码器。如果失败，则提供一个回退或抛出错误。
let decodeRPack
try {
	// 假设 @risuai/rpack-rust 在 Node.js 中可以这样导入和使用
	// 你可能需要检查其具体的导出方式和用法
	const rpack = await import('./rpack.mjs')
	decodeRPack = rpack.decodeRPack // 或者它直接导出 decodeRPack
	if (!(decodeRPack instanceof Function)) {
		console.warn('@risuai/rpack-rust loaded, but decodeRPack is not a function. Module parsing might fail.')
		decodeRPack = null // 确保后续逻辑知道它不可用
	}
}
catch (err) {
	console.warn('Failed to load @risuai/rpack-rust. Risu module (.risum) parsing will be limited or disabled.', err)
	decodeRPack = null
}

/**
 * 解析 .risum 文件 Buffer
 * @param {Buffer} moduleBuffer 模块缓冲区
 * @returns {Promise<{moduleDef: object, assetsData: Buffer[]}|null>}
 *          moduleDef: 解析后的模块定义JSON对象 (RisuModule 结构)
 *          assetsData: 模块内嵌的资源Buffer数组
 *          返回 null 如果无法解析
 */
export async function parseRisuModule(moduleBuffer) {
	if (!decodeRPack) {
		console.error('RPack decoder is not available. Cannot parse .risum module.')
		return null // 或者只尝试解析非 rpack 部分，如果规范允许
	}

	try {
		let pos = 0
		/**
		 * 读取字节
		 * @returns {number}
		 */
		const readByte = () => moduleBuffer.readUInt8(pos++)
		/**
		 * 读取长度
		 * @returns {number}
		 */
		const readLength = () => {
			const len = moduleBuffer.readUInt32LE(pos)
			pos += 4
			return len
		}
		/**
		 * 读取数据
		 * @param {any} len 长度
		 * @returns {Buffer}
		 */
		const readData = len => {
			const data = moduleBuffer.subarray(pos, pos + len)
			pos += len
			return data
		}

		if (readByte() !== 111) throw new Error('Invalid module magic number')
		const version = readByte() // Risu 源码中版本为0
		if (version !== 0) console.warn(`Unexpected module version: ${version}. Parsing might be incorrect.`)

		const mainLen = readLength()
		const mainDataPacked = readData(mainLen)

		// decodeRPack 的输入和输出类型需要根据实际库确定
		// Risu 源码是用 Buffer.from(await decodeRPack(mainDataPacked)).toString()
		const mainDataUnpacked = await decodeRPack(mainDataPacked)
		const mainJsonString = Buffer.isBuffer(mainDataUnpacked) ? mainDataUnpacked.toString('utf-8') : new TextDecoder().decode(mainDataUnpacked)
		const mainJson = JSON.parse(mainJsonString)

		if (mainJson.type !== 'risuModule') throw new Error(`Invalid module type in metadata: ${mainJson.type}`)

		const moduleDef = mainJson.module // 这是 RisuModule 结构
		const assetsData = []

		// moduleDef.assets 此时是元数据列表 [{name, uri(空), ext}, ...]
		// 我们需要根据这个列表的长度来读取后续的资源数据块
		const expectedAssetCount = moduleDef.assets?.length || 0

		for (let i = 0; i < expectedAssetCount; i++) {
			if (pos >= moduleBuffer.length) {
				console.warn(`Module parsing ended prematurely: expected ${expectedAssetCount} assets, found ${i} before EOF.`)
				break
			}
			const mark = readByte()
			if (!mark) { // 提前遇到文件结束标记
				console.warn(`Module parsing: found EOF mark after ${i} assets, expected ${expectedAssetCount}.`)
				break
			}
			if (mark !== 1) throw new Error(`Invalid asset mark: ${mark} for asset ${i}`)

			const assetLen = readLength()
			const assetDataPacked = readData(assetLen)
			const assetDataUnpacked = await decodeRPack(assetDataPacked)
			assetsData.push(Buffer.isBuffer(assetDataUnpacked) ? assetDataUnpacked : Buffer.from(assetDataUnpacked))
		}

		// 检查文件末尾是否有多余数据或正确的结束标记
		if (pos < moduleBuffer.length && readByte() !== 0)
			console.warn('Module file has trailing data after expected assets and EOF mark.')


		return { moduleDef, assetsData }
	}
	catch (error) {
		console.error('Error parsing Risu module:', error)
		return null
	}
}
