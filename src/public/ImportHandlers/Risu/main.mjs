import { Buffer } from 'node:buffer'
import fsSync from 'node:fs' // For existsSync
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import url from 'node:url'

import sanitizeFilename from 'npm:sanitize-filename'


import { saveJsonFile } from '../../../scripts/json_loader.mjs' // 调整路径
import { loadPart } from '../../../server/managers/index.mjs' // 调整路径
import { isPartLoaded } from '../../../server/parts_loader.mjs' // 调整路径

import { convertCCv3ToSTv2 } from './ccv3-converter.mjs'
import { unzipCharx } from './charx-parser.mjs'
import { getAvailablePath } from './path.mjs'
import { extractPngCardData } from './png-parser.mjs'
import { downloadRisuCard, downloadAsset } from './risu-api.mjs'



// Helper to save assets and update URIs
async function saveAndNormalizeAsset(assetBuffer, originalName, targetDir, assetSubDir, assetTypeForLog = 'asset') {
	const safeOriginalName = sanitizeFilename(originalName || `${assetTypeForLog}_${Date.now()}`)
	const targetAssetPath = assetSubDir + '/' + safeOriginalName
	const fullTargetPath = path.join(targetDir, 'public', targetAssetPath)

	await mkdir(path.dirname(fullTargetPath), { recursive: true })
	await writeFile(fullTargetPath, assetBuffer)
	return targetAssetPath // 返回相对路径
}


async function ImportAsData(username, dataBuffer) {
	const tempExtractDir = path.join(tmpdir(), `fount_risu_import_${Date.now()}`)
	await mkdir(tempExtractDir, { recursive: true })

	let ccv3Card
	let charxAssets = new Map() // Map<internal_zip_path, Buffer> from charx assets/
	let pngEmbeddedAssets = new Map() // Map<asset_id, Buffer> from png chara-ext-asset_:
	let risuModuleDef
	let mainImageBuffer // 主图片 (PNG本身或CHARX内的主图标)
	let sourceSpec // 'ccv3' or 'ccv2'

	try {
		const errors = []
		try {
			const charxData = await unzipCharx(dataBuffer)
			ccv3Card = charxData.card
			charxAssets = charxData.assets // 包含 module 内资源（uri已更新为 embeded://__module_asset__/*）和 charx assets/*
			risuModuleDef = charxData.moduleData
			mainImageBuffer = charxData.mainImage // 可能为 undefined
			sourceSpec = 'ccv3' // CHARX 总是 CCv3
		} catch (err) { errors.push(err) }
		try {
			const pngData = await extractPngCardData(dataBuffer)
			ccv3Card = pngData.card
			pngEmbeddedAssets = pngData.assets
			mainImageBuffer = pngData.image // PNG 本身作为主图片
			sourceSpec = pngData.spec // 'ccv3', 'ccv2', or 'ccv2_generic'
		} catch (err) { errors.push(err) }
		try {
			ccv3Card = JSON.parse(dataBuffer.toString('utf-8'))
			// JSON 文件没有内嵌资源或主图片文件，依赖 card.data.assets 中的 HTTP/Data URI
			sourceSpec = ccv3Card.spec === 'chara_card_v3' ? 'ccv3' : ccv3Card.spec === 'chara_card_v2' ? 'ccv2' : 'unknown_json'
		} catch (err) { errors.push(err) }
		if (!ccv3Card) throw new Error(`Unsupported file type.\nErrors: ${errors.map(e => e.stack).join('\n')}`)


		if (!ccv3Card.data) throw new Error('Invalid or missing card data.')

		// 如果是 SillyTavern V2 卡片，直接使用 ST 导入器逻辑（如果可以调用的话）
		// 或者在这里实现一个简化的 STv2 到 fount Part 的转换。
		// 目前这个 Risu 导入器专注于 CCv3 (和通过 PNG 导入的 CCv2)。
		// 如果 sourceSpec 是 'ccv2' 或 'ccv2_generic'，ccv3Card 实际上是 STv2 格式。
		// 我们可以直接用它，或者用一个适配器转成我们期望的 STv2 格式。
		// convertCCv3ToSTv2 设计上是处理 CCv3 的，如果传入 STv2 卡片，行为可能不正确。
		// 因此，如果检测到是 STv2，应该有不同的处理路径。
		// 为简化，我们假设此导入器主要目标是 CCv3，对 PNG 中的 STv2 做最简转换或提示用户用 ST 导入器。
		// 此处为了继续流程，如果 spec 是 ccv2，我们假设 ccv3Card 就是可以直接用的 STv2 结构。
		// 更好的做法是分离逻辑。但根据题目，我们专注于 Risu CCv3。

		if (sourceSpec !== 'ccv3')
			throw new Error(`This Risu importer primarily handles CCv3. Detected ${sourceSpec}. Please use the SillyTavern importer if applicable.`)

		const charName = sanitizeFilename(ccv3Card.data.name || `RisuChar_${Date.now()}`)
		const targetPath = await getAvailablePath(username, 'chars', charName)
		await mkdir(targetPath, { recursive: true })

		// 处理卡片定义的资源 (ccv3Card.data.assets)
		const processedAssetsForST = [] // 用于放入 stV2Data.extensions.risu_assets
		if (ccv3Card.data.assets && Array.isArray(ccv3Card.data.assets))
			for (const assetDef of ccv3Card.data.assets) {
				let assetBuffer
				let assetFilename = sanitizeFilename(assetDef.name || `asset_${assetDef.type || 'unknown'}`) + `.${assetDef.ext || 'bin'}`
				const originalUri = assetDef.uri

				try {
					if (assetDef.uri.startsWith('embeded://')) {
						const internalPath = assetDef.uri.substring('embeded://'.length)
						assetBuffer = charxAssets.get(internalPath)
						if (!assetBuffer) throw new Error(`Embedded asset not found in CHARX: ${internalPath}`)
					}
					else if (assetDef.uri.startsWith('__asset:')) { // PNG 内嵌 (ccardlib 风格)
						const assetId = assetDef.uri.substring('__asset:'.length)
						assetBuffer = pngEmbeddedAssets.get(assetId)
						if (!assetBuffer) throw new Error(`PNG embedded asset not found: ${assetId}`)
					}
					else if (assetDef.uri.startsWith('data:')) {
						const parts = assetDef.uri.split(',')
						const b64data = parts[1]
						assetBuffer = Buffer.from(b64data, 'base64')
					}
					else if (assetDef.uri.startsWith('http')) {
						console.log(`Downloading asset: ${assetDef.uri}`)
						assetBuffer = await downloadAsset(assetDef.uri)
					}
					else if (assetDef.uri === 'ccdefault:')
						if (mainImageBuffer) { // 仅当PNG导入时，ccdefault: 指向PNG本身
							assetBuffer = mainImageBuffer
							assetFilename = `image_default.${assetDef.ext || 'png'}` // 主图片通常是png
						}
						else {
							// 对于非PNG导入，或无法确定ccdefault，跳过或用占位符
							console.warn(`ccdefault: URI encountered for non-PNG or missing main image, asset "${assetDef.name}" skipped.`)
							continue
						}
					else {
						console.warn(`Unsupported URI scheme for asset "${assetDef.name}": ${assetDef.uri}`)
						continue
					}

					const savedRelPath = await saveAndNormalizeAsset(assetBuffer, assetFilename, targetPath, 'risu_assets', assetDef.type)
					// 更新 assetDef 中的 uri，供 converter 使用，或存入 stV2Data.extensions
					processedAssetsForST.push({
						type: assetDef.type,
						name: assetDef.name,
						ext: assetDef.ext,
						original_uri: originalUri, // 保留原始 URI 供参考
						fount_uri: savedRelPath // fount 内部的相对路径
					})

					// 如果这个资源是主头像，也单独处理一下
					if (assetDef.type === 'icon' && assetDef.name === 'main' && !fsSync.existsSync(path.join(targetPath, 'public', `image.${assetDef.ext || 'png'}`))) {
						const imagePath = path.join(targetPath, 'public', `image.${assetDef.ext || 'png'}`)
						await mkdir(path.dirname(imagePath), { recursive: true })
						await writeFile(imagePath, assetBuffer)
					}
				}
				catch (err) {
					console.error(`Failed to process asset ${assetDef.name} (uri: ${originalUri}): ${err.message}`)
				}
			}


		// 如果循环完 card.data.assets 后主头像仍未写入，且 mainImageBuffer 存在 (来自PNG或CHARX提取)
		// 则将其保存为 image.png
		const avatarPath = path.join(targetPath, 'public', 'image.png')
		if (!fsSync.existsSync(avatarPath) && mainImageBuffer)
			try {
				await mkdir(path.dirname(avatarPath), { recursive: true })
				// 尝试确定原始扩展名，但为简单起见，这里统一保存为png
				// 你可能需要一个图像转换库（如sharp）来确保它是PNG格式
				// 或者保存为 image.<original_ext> 并让模板处理
				await writeFile(avatarPath, mainImageBuffer)
				console.log('Saved main image buffer as image.png')
			}
			catch (imgErr) {
				console.error('Failed to save main image buffer:', imgErr)
			}
		else if (!fsSync.existsSync(avatarPath))
			console.warn('Main avatar image.png could not be created.')


		// 将 CHARX 中 assets/ 目录下但未被 card.data.assets 引用的文件也保存下来
		for (const [internalPath, buffer] of charxAssets.entries()) {
			// 检查是否已被 card.data.assets 处理过 (通过 embeded:// URI)
			const alreadyProcessed = processedAssetsForST.some(pa => pa.original_uri === `embeded://${internalPath}`)
			if (!alreadyProcessed && internalPath.startsWith('assets/')) try { // 只保存 assets/ 目录下的
				const filename = path.basename(internalPath)
				// 将 CHARX 内部的 assets/ 目录结构映射到 risu_assets/charx_provided/
				const relativeSavePath = ['risu_assets', 'charx_provided', internalPath.substring('assets/'.length)].join('/')
				const fullSavePath = path.join(targetPath, 'public', relativeSavePath)
				await mkdir(path.dirname(fullSavePath), { recursive: true })
				await writeFile(fullSavePath, buffer)
				processedAssetsForST.push({ // 记录这些额外保存的资源
					type: 'charx_unreferenced_asset',
					name: filename,
					ext: path.extname(filename).substring(1),
					original_uri: `embeded://${internalPath}`,
					fount_uri: relativeSavePath
				})
			} catch (err) {
				console.error(`Failed to save unreferenced CHARX asset ${internalPath}: ${err.message}`)
			}
		}

		// 转换数据到 STv2 格式
		const stV2Data = convertCCv3ToSTv2(ccv3Card, risuModuleDef)
		stV2Data.extensions.risu_assets = processedAssetsForST // 附加上处理过的资源信息

		// 保存 chardata.json
		await saveJsonFile(path.join(targetPath, 'chardata.json'), stV2Data)

		// 复制模板 main.mjs
		const templateMainMjsPath = path.join(import.meta.dirname, 'Template', 'main.mjs')
		const targetMainMjsPath = path.join(targetPath, 'main.mjs')
		const templateContent = fsSync.readFileSync(templateMainMjsPath, 'utf-8')
		// 你可以在这里对模板内容进行一些基于 ccv3Card 或 stV2Data 的动态替换，如果需要的话
		await writeFile(targetMainMjsPath, templateContent)

		// 加载或重载部件
		const needsReload = isPartLoaded(username, 'chars', charName)
		if (needsReload)
			await loadPart(username, 'chars', charName)
		else
			// 尝试动态导入，如果 fount 支持的话。否则 loadPart 应该处理首次加载。
			import(url.pathToFileURL(targetMainMjsPath)).catch(err => console.error(`Dynamic import of ${targetMainMjsPath} failed:`, err))

		console.log(`Risu character "${charName}" imported successfully to ${targetPath}`)
		return [{ parttype: 'chars', partname: charName }]
	}
	catch (error) {
		console.error('Error during Risu import:', error)
		await rm(tempExtractDir, { recursive: true, force: true }).catch(() => { }) // 清理临时目录
		throw error // 重新抛出错误，让上层处理
	}
	finally {
		await rm(tempExtractDir, { recursive: true, force: true }).catch(() => { })
	}
}

async function ImportByText(username, text) {
	const lines = text.trim().split('\n').map(line => line.trim()).filter(line => line)
	const errors = []
	const installedParts = []

	for (const line of lines)
		if (line.startsWith('http')) {
			// 优先匹配 Risu Realm URL
			const risuMatch = line.match(/realm\.risuai\.net\/character\/([\da-f-]+)/i)
			if (risuMatch && risuMatch[1]) {
				const uuid = risuMatch[1]
				try {
					console.log(`Downloading Risu card with UUID: ${uuid}`)
					const { buffer, filename: downloadedFilename } = await downloadRisuCard(uuid)
					installedParts.push(...await ImportAsData(username, buffer, downloadedFilename))
					continue // 处理完这个 URL，继续下一个
				}
				catch (err) {
					console.error(`Failed to import Risu card from URL ${line}:`, err)
					errors.push(`Failed for ${line}: ${err.message}`)
					// 不再尝试作为通用文件下载，因为这很可能是特定于Risu的链接
				}
			}
			// 如果不是 Risu 特有链接，可以尝试作为通用文件下载 (如果你的fount/main.mjs有这个逻辑)
			// 但这个 Risu 导入器主要处理 Risu 卡，其他 URL 可以忽略或交给通用导入器
			else errors.push(`non-Risu URL: ${line}`)
		}
		else errors.push(`Invalid line (not a URL): ${line}`)

	if (errors.length)
		throw new Error(`Some Risu imports failed:\n${errors.join('\n')}`)
	return installedParts
}


export default {
	info: {
		'': { // 默认语言
			name: 'RisuAI Importer',
			avatar: '', // 可选：导入器本身的图标
			description: 'Imports Risu Character Cards (V3) in .png, .charx, or .json format, and from realm.risuai.net URLs.',
			description_markdown: 'Imports Risu Character Cards (V3) in `.png`, `.charx`, or `.json` format, and from `realm.risuai.net` URLs.\nSupports CCv3 features including embedded assets and lorebooks.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '', // 可选：相关链接
			tags: ['risu', 'character card', 'ccv3', 'import'],
		}
	},
	interfaces: {
		import: {
			ImportAsData,
			ImportByText,
		}
	}
}
