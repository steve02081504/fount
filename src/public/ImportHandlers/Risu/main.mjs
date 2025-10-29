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



/**
 * @description 保存资源并规范化 URI。
 * @param {Buffer} assetBuffer - 资源缓冲区。
 * @param {string} originalName - 原始文件名。
 * @param {string} targetDir - 目标目录。
 * @param {string} assetSubDir - 资源子目录。
 * @param {string} [assetTypeForLog='asset'] - 用于日志的资源类型。
 * @returns {Promise<string>} - 返回相对路径。
 */
async function saveAndNormalizeAsset(assetBuffer, originalName, targetDir, assetSubDir, assetTypeForLog = 'asset') {
	const safeOriginalName = sanitizeFilename(originalName || `${assetTypeForLog}_${Date.now()}`)
	const targetAssetPath = assetSubDir + '/' + safeOriginalName
	const fullTargetPath = path.join(targetDir, 'public', targetAssetPath)

	await mkdir(path.dirname(fullTargetPath), { recursive: true })
	await writeFile(fullTargetPath, assetBuffer)
	return targetAssetPath // 返回相对路径
}


/**
 * @description 将数据作为 Risu 角色导入。
 * @param {string} username - 用户名。
 * @param {Buffer} dataBuffer - 数据缓冲区。
 * @returns {Promise<Array<{ parttype: string; partname: string }>>} - 导入的部分信息数组。
 */
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

		if (sourceSpec !== 'ccv3')
			throw new Error(`This Risu importer primarily handles CCv3. Detected ${sourceSpec}. Please use the SillyTavern importer if applicable.`)

		const charName = sanitizeFilename(ccv3Card.data.name || `RisuChar_${Date.now()}`)
		const targetPath = await getAvailablePath(username, 'chars', charName)
		await mkdir(targetPath, { recursive: true })

		const processedAssetsForST = []
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
					else if (assetDef.uri.startsWith('__asset:')) {
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
						if (mainImageBuffer) {
							assetBuffer = mainImageBuffer
							assetFilename = `image_default.${assetDef.ext || 'png'}`
						}
						else {
							console.warn(`ccdefault: URI encountered for non-PNG or missing main image, asset "${assetDef.name}" skipped.`)
							continue
						}
					else {
						console.warn(`Unsupported URI scheme for asset "${assetDef.name}": ${assetDef.uri}`)
						continue
					}

					const savedRelPath = await saveAndNormalizeAsset(assetBuffer, assetFilename, targetPath, 'risu_assets', assetDef.type)
					processedAssetsForST.push({
						type: assetDef.type,
						name: assetDef.name,
						ext: assetDef.ext,
						original_uri: originalUri,
						fount_uri: savedRelPath
					})

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


		const avatarPath = path.join(targetPath, 'public', 'image.png')
		if (!fsSync.existsSync(avatarPath) && mainImageBuffer)
			try {
				await mkdir(path.dirname(avatarPath), { recursive: true })
				await writeFile(avatarPath, mainImageBuffer)
				console.log('Saved main image buffer as image.png')
			}
			catch (imgErr) {
				console.error('Failed to save main image buffer:', imgErr)
			}
		else if (!fsSync.existsSync(avatarPath))
			console.warn('Main avatar image.png could not be created.')


		for (const [internalPath, buffer] of charxAssets.entries()) {
			const alreadyProcessed = processedAssetsForST.some(pa => pa.original_uri === `embeded://${internalPath}`)
			if (!alreadyProcessed && internalPath.startsWith('assets/')) try {
				const filename = path.basename(internalPath)
				const relativeSavePath = ['risu_assets', 'charx_provided', internalPath.substring('assets/'.length)].join('/')
				const fullSavePath = path.join(targetPath, 'public', relativeSavePath)
				await mkdir(path.dirname(fullSavePath), { recursive: true })
				await writeFile(fullSavePath, buffer)
				processedAssetsForST.push({
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

		const stV2Data = convertCCv3ToSTv2(ccv3Card, risuModuleDef)
		stV2Data.extensions.risu_assets = processedAssetsForST

		await saveJsonFile(path.join(targetPath, 'chardata.json'), stV2Data)

		const templateMainMjsPath = path.join(import.meta.dirname, 'Template', 'main.mjs')
		const targetMainMjsPath = path.join(targetPath, 'main.mjs')
		const templateContent = fsSync.readFileSync(templateMainMjsPath, 'utf-8')
		await writeFile(targetMainMjsPath, templateContent)

		const needsReload = isPartLoaded(username, 'chars', charName)
		if (needsReload)
			await loadPart(username, 'chars', charName)
		else
			import(url.pathToFileURL(targetMainMjsPath)).catch(err => console.error(`Dynamic import of ${targetMainMjsPath} failed:`, err))

		console.log(`Risu character "${charName}" imported successfully to ${targetPath}`)
		return [{ parttype: 'chars', partname: charName }]
	}
	catch (error) {
		console.error('Error during Risu import:', error)
		await rm(tempExtractDir, { recursive: true, force: true }).catch(() => { })
		throw error
	}
	finally {
		await rm(tempExtractDir, { recursive: true, force: true }).catch(() => { })
	}
}

/**
 * @description 通过文本导入 Risu 角色。
 * @param {string} username - 用户名。
 * @param {string} text - 包含 Risu 角色 URL 的文本。
 * @returns {Promise<Array<{ parttype: string; partname: string }>>} - 导入的部分信息数组。
 */
async function ImportByText(username, text) {
	const lines = text.trim().split('\n').map(line => line.trim()).filter(line => line)
	const errors = []
	const installedParts = []

	for (const line of lines)
		if (line.startsWith('http')) {
			const risuMatch = line.match(/realm\.risuai\.net\/character\/([\da-f-]+)/i)
			if (risuMatch && risuMatch[1]) {
				const uuid = risuMatch[1]
				try {
					console.log(`Downloading Risu card with UUID: ${uuid}`)
					const { buffer, filename: downloadedFilename } = await downloadRisuCard(uuid)
					installedParts.push(...await ImportAsData(username, buffer, downloadedFilename))
					continue
				}
				catch (err) {
					console.error(`Failed to import Risu card from URL ${line}:`, err)
					errors.push(`Failed for ${line}: ${err.message}`)
				}
			}
			else errors.push(`non-Risu URL: ${line}`)
		}
		else errors.push(`Invalid line (not a URL): ${line}`)

	if (errors.length)
		throw new Error(`Some Risu imports failed:\n${errors.join('\n')}`)
	return installedParts
}


export default {
	info: {
		'': {
			name: 'RisuAI Importer',
			avatar: '',
			description: 'Imports Risu Character Cards (V3) in .png, .charx, or .json format, and from realm.risuai.net URLs.',
			description_markdown: 'Imports Risu Character Cards (V3) in `.png`, `.charx`, or `.json` format, and from `realm.risuai.net` URLs.\nSupports CCv3 features including embedded assets and lorebooks.',
			version: '0.0.1',
			author: 'steve02081504',
			home_page: '',
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
