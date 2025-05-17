import JSZip from 'npm:jszip'
import { parseRisuModule } from './module-parser.mjs'

/**
 * 解压并解析 CHARX (.zip) 文件 Buffer
 * @param {Buffer} zipBuffer
 * @returns {Promise<{card: object, assets: Map<string, Buffer>, moduleData?: object, mainImage?: Buffer}>}
 *          card: card.json 解析后的对象
 *          assets: Map<relative_path_in_zip, asset_buffer> (来自 zip 内的 assets/ 目录)
 *          moduleData: module.risum 解析后的模块定义 (RisuModule 结构)
 *          mainImage: 如果 card.json 中 assets 指向 embeded:// 并类型为 icon/main，则尝试提取该图片
 */
export async function unzipCharx(zipBuffer) {
	const zip = await JSZip.loadAsync(zipBuffer)
	let card = null
	const assets = new Map() // 用于存放 zip 内 assets/ 目录下的文件
	let moduleData = null // 用于存放 module.risum 解析出的 moduleDef
	let moduleAssetsData = [] // 用于存放 module.risum 解析出的内嵌资源

	// 1. 解析 card.json
	const cardFile = zip.file('card.json')
	if (!cardFile)
		throw new Error('CHARX is missing card.json')

	const cardJsonContent = await cardFile.async('string')
	card = JSON.parse(cardJsonContent)

	// 2. 解析 module.risum (如果存在)
	const moduleFile = zip.file('module.risum')
	if (moduleFile) {
		const moduleBuffer = await moduleFile.async('nodebuffer')
		const parsedModule = await parseRisuModule(moduleBuffer)
		if (parsedModule) {
			moduleData = parsedModule.moduleDef
			moduleAssetsData = parsedModule.assetsData // 这些是 moduleDef.assets 引用的实际数据

			// 将 module.risum 内的资源也放入 assets Map，用特殊前缀标识
			// moduleDef.assets 是 [{name, uri(空), ext}, ...]
			// moduleAssetsData 是对应的 Buffer 数组
			if (moduleData.assets && Array.isArray(moduleData.assets))
				for (let i = 0; i < moduleData.assets.length; i++) {
					const assetMeta = moduleData.assets[i]
					if (moduleAssetsData[i]) {
						// 为这些资源创建一个唯一的内部路径名
						const moduleAssetPath = `__module_asset__/${assetMeta.name || `asset_${i}`}.${assetMeta.ext || 'bin'}`
						assets.set(moduleAssetPath, moduleAssetsData[i])
						// 更新 moduleDef 中该资源的 uri，指向这个内部路径，以便后续统一处理
						assetMeta.uri = `embeded://${moduleAssetPath}`
					}
				}

		}
	}

	// 3. 提取 assets/ 目录下的文件
	for (const relativePath in zip.files) {
		if (zip.files[relativePath].dir) continue // 跳过目录

		if (relativePath.startsWith('assets/')) {
			const file = zip.files[relativePath]
			const buffer = await file.async('nodebuffer')
			assets.set(relativePath, buffer) // key 是 zip 内的完整相对路径，如 'assets/icon/images/1.png'
		}
	}

	// 4. 尝试提取主图片 (用于简化后续步骤中的头像设置)
	// CCv3 spec: assets 字段是必须的，如果未定义，行为如同默认值。
	// 我们这里以实际的 card.data.assets 为准。
	let mainImageBuffer
	if (card.data && card.data.assets && Array.isArray(card.data.assets)) {
		const mainIconAsset = card.data.assets.find(a => a.type === 'icon' && a.name === 'main')
		if (mainIconAsset && mainIconAsset.uri && mainIconAsset.uri.startsWith('embeded://')) {
			const assetPathInZip = mainIconAsset.uri.substring('embeded://'.length)
			if (assets.has(assetPathInZip))
				mainImageBuffer = assets.get(assetPathInZip)

		}
	}


	return { card, assets, moduleData, mainImage: mainImageBuffer }
}
