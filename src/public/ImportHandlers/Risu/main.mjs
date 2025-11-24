import { Buffer } from 'node:buffer'
import fsSync from 'node:fs' // For existsSync
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import url from 'node:url'

import sanitizeFilename from 'npm:sanitize-filename'


import { saveJsonFile } from '../../../scripts/json_loader.mjs'
import { loadPart } from '../../../server/managers/index.mjs'
import { isPartLoaded } from '../../../server/parts_loader.mjs'

import { convertCCv3ToSTv2 } from './ccv3-converter.mjs'
import { unzipCharx } from './charx-parser.mjs'
import { getAvailablePath } from './path.mjs'
import { extractPngCardData } from './png-parser.mjs'
import { downloadRisuCard, downloadAsset } from './risu-api.mjs'



/**
 * 保存资源并规范化 URI。
 * @param {Buffer} assetBuffer - 资源缓冲区。
 * @param {string} originalName - 原始文件名。
 * @param {string} targetDir - 目标目录。
 * @param {string} assetSubDir - 资源子目录。
 * @param {string} [assetTypeForLog='asset'] - 用于日志记录的资源类型。
 * @returns {Promise<string>} 返回一个包含已保存资源相对路径的 Promise。
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
 * 将数据作为 Risu 角色导入。
 * @param {string} username - 用户名。
 * @param {Buffer} dataBuffer - 数据缓冲区。
 * @returns {Promise<Array<{ parttype: string; partname: string }>>} 一个 Promise，解析为一个包含已导入部分信息的对象数组。
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
 * 通过文本导入 Risu 角色。
 * @param {string} username - 用户名。
 * @param {string} text - 包含 Risu 角色 URL 的文本。
 * @returns {Promise<Array<{ parttype: string; partname: string }>>} 一个 Promise，解析为一个包含已导入部分信息的对象数组。
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
					const { buffer } = await downloadRisuCard(uuid)
					installedParts.push(...await ImportAsData(username, buffer))
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


/**
 * @type {import('../../../decl/import.ts').import_handler_t}
 */
export default {
	info: {
		'en-UK': {
			name: 'RisuAI Importer',
			avatar: 'https://risuai.net/favicon.png',
			description: 'Imports Risu Character Cards (V3) in .png, .charx, or .json format, and from realm.risuai.net URLs.',
			description_markdown: 'Imports Risu Character Cards (V3) in `.png`, `.charx`, or `.json` format, and from `realm.risuai.net` URLs.\nSupports CCv3 features including embedded assets and lorebooks.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://risuai.net/',
			tags: ['risu', 'character card', 'ccv3', 'import']
		},
		'zh-CN': {
			name: 'RisuAI 导入器',
			avatar: 'https://risuai.net/favicon.png',
			description: '导入 Risu 角色卡 (V3) 的 .png, .charx, 或 .json 格式文件，以及 realm.risuai.net 的网址。',
			description_markdown: '导入 Risu 角色卡 (V3) 的 `.png`, `.charx`, 或 `.json` 格式文件，以及 `realm.risuai.net` 的网址。\n支持 CCv3 功能，包括内嵌资源和 lorebooks。',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://risuai.net/',
			tags: ['risu', '角色卡', 'ccv3', '导入']
		},
		'ar-SA': {
			name: 'مستورد RisuAI',
			avatar: 'https://risuai.net/favicon.png',
			description: 'يستورد بطاقات شخصيات Risu (V3) بتنسيق .png أو .charx أو .json، ومن عناوين URL الخاصة بـ realm.risuai.net.',
			description_markdown: 'يستورد بطاقات شخصيات Risu (V3) بتنسيق .png أو .charx أو .json، ومن عناوين URL الخاصة بـ `realm.risuai.net`.\nيدعم ميزات CCv3 بما في ذلك الأصول المضمنة وكتب التقاليد.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://risuai.net/',
			tags: ['risu', 'بطاقة شخصية', 'ccv3', 'استيراد']
		},
		'de-DE': {
			name: 'RisuAI-Importer',
			avatar: 'https://risuai.net/favicon.png',
			description: 'Importiert Risu-Charakterkarten (V3) im .png-, .charx- oder .json-Format und von realm.risuai.net-URLs.',
			description_markdown: 'Importiert Risu-Charakterkarten (V3) im `.png`-, `.charx`- oder `.json`-Format und von `realm.risuai.net`-URLs.\nUnterstützt CCv3-Funktionen einschließlich eingebetteter Assets und Lorebooks.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://risuai.net/',
			tags: ['risu', 'Charakterkarte', 'ccv3', 'Import']
		},
		emoji: {
			name: '🐿️ RisuAI Importer',
			avatar: 'https://risuai.net/favicon.png',
			description: 'Imports Risu Character Cards (V3) in .png, .charx, or .json format, and from realm.risuai.net URLs.',
			description_markdown: 'Imports Risu Character Cards (V3) in `.png`, `.charx`, or `.json` format, and from `realm.risuai.net` URLs.\nSupports CCv3 features including embedded assets and lorebooks.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://risuai.net/',
			tags: ['risu', 'character card', 'ccv3', 'import']
		},
		'es-ES': {
			name: 'Importador de RisuAI',
			avatar: 'https://risuai.net/favicon.png',
			description: 'Importa tarjetas de personaje de Risu (V3) en formato .png, .charx o .json, y desde URLs de realm.risuai.net.',
			description_markdown: 'Importa tarjetas de personaje de Risu (V3) en formato `.png`, `.charx` o `.json`, y desde URLs de `realm.risuai.net`.\nAdmite funciones de CCv3, incluidos los activos incrustados y los libros de lore.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://risuai.net/',
			tags: ['risu', 'tarjeta de personaje', 'ccv3', 'importar']
		},
		'fr-FR': {
			name: 'Importateur RisuAI',
			avatar: 'https://risuai.net/favicon.png',
			description: 'Importe les cartes de personnage Risu (V3) au format .png, .charx ou .json, et à partir des URL de realm.risuai.net.',
			description_markdown: 'Importe les cartes de personnage Risu (V3) au format `.png`, `.charx` ou `.json`, et à partir des URL de `realm.risuai.net`.\nPrend en charge les fonctionnalités de CCv3, y compris les actifs intégrés et les lorebooks.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://risuai.net/',
			tags: ['risu', 'carte de personnage', 'ccv3', 'importer']
		},
		'hi-IN': {
			name: 'RisuAI आयातक',
			avatar: 'https://risuai.net/favicon.png',
			description: 'Risu कैरेक्टर कार्ड (V3) को .png, .charx, या .json प्रारूप में, और realm.risuai.net URL से आयात करता है।',
			description_markdown: 'Risu कैरेक्टर कार्ड (V3) को `.png`, `.charx`, या `.json` प्रारूप में, और `realm.risuai.net` URL से आयात करता है।\nएम्बेडेड संपत्ति और लोरबुक सहित CCv3 सुविधाओं का समर्थन करता है।',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://risuai.net/',
			tags: ['risu', 'कैरेक्टर कार्ड', 'ccv3', 'आयात']
		},
		'is-IS': {
			name: 'RisuAI innflytjandi',
			avatar: 'https://risuai.net/favicon.png',
			description: 'Flytur inn Risu persónukort (V3) á .png, .charx eða .json sniði og frá realm.risuai.net vefslóðum.',
			description_markdown: 'Flytur inn Risu persónukort (V3) á `.png`, `.charx` eða `.json` sniði og frá `realm.risuai.net` vefslóðum.\nStyður CCv3 eiginleika, þar á meðal innfelldar eignir og lorebooks.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://risuai.net/',
			tags: ['risu', 'persónukort', 'ccv3', 'innflutningur']
		},
		'it-IT': {
			name: 'Importatore RisuAI',
			avatar: 'https://risuai.net/favicon.png',
			description: 'Importa le carte personaggio Risu (V3) in formato .png, .charx o .json e dagli URL di realm.risuai.net.',
			description_markdown: 'Importa le carte personaggio Risu (V3) in formato `.png`, `.charx` o `.json` e dagli URL di `realm.risuai.net`.\nSupporta le funzionalità di CCv3, inclusi asset incorporati e lorebook.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://risuai.net/',
			tags: ['risu', 'carta personaggio', 'ccv3', 'importa']
		},
		'ja-JP': {
			name: 'RisuAI インポーター',
			avatar: 'https://risuai.net/favicon.png',
			description: 'Risuキャラクターカード（V3）を.png、.charx、または.json形式で、およびrealm.risuai.netのURLからインポートします。',
			description_markdown: 'Risuキャラクターカード（V3）を`.png`、`.charx`、または`.json`形式で、および`realm.risuai.net`のURLからインポートします。\n埋め込みアセットや伝承本などのCCv3機能をサポートします。',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://risuai.net/',
			tags: ['risu', 'キャラクターカード', 'ccv3', 'インポート']
		},
		'ko-KR': {
			name: 'RisuAI 가져오기',
			avatar: 'https://risuai.net/favicon.png',
			description: 'Risu 캐릭터 카드(V3)를 .png, .charx 또는 .json 형식으로, 그리고 realm.risuai.net URL에서 가져옵니다.',
			description_markdown: 'Risu 캐릭터 카드(V3)를 `.png`, `.charx` 또는 `.json` 형식으로, 그리고 `realm.risuai.net` URL에서 가져옵니다.\n임베디드 자산 및 lorebook을 포함한 CCv3 기능을 지원합니다.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://risuai.net/',
			tags: ['risu', '캐릭터 카드', 'ccv3', '가져오기']
		},
		lzh: {
			name: 'RisuAI 納入司',
			avatar: 'https://risuai.net/favicon.png',
			description: '納入 Risu 角色符（V3），式如 .png、.charx 或 .json，亦可自 realm.risuai.net 網址納入。',
			description_markdown: '納入 Risu 角色符（V3），式如 `.png`、`.charx` 或 `.json`，亦可自 `realm.risuai.net` 網址納入。\n支援 CCv3 之能，含內嵌資源與傳承錄。',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://risuai.net/',
			tags: ['risu', '角色符', 'ccv3', '納入']
		},
		'nl-NL': {
			name: 'RisuAI-importeur',
			avatar: 'https://risuai.net/favicon.png',
			description: 'Importeert Risu-personagekaarten (V3) in .png-, .charx- of .json-indeling en van realm.risuai.net-URL\'s.',
			description_markdown: 'Importeert Risu-personagekaarten (V3) in `.png`-, `.charx`- of `.json`-indeling en van `realm.risuai.net`-URL\'s.\nOndersteunt CCv3-functies, waaronder ingesloten middelen en lorebooks.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://risuai.net/',
			tags: ['risu', 'personagekaart', 'ccv3', 'importeren']
		},
		'pt-PT': {
			name: 'Importador RisuAI',
			avatar: 'https://risuai.net/favicon.png',
			description: 'Importa cartões de personagem Risu (V3) no formato .png, .charx ou .json e de URLs realm.risuai.net.',
			description_markdown: 'Importa cartões de personagem Risu (V3) no formato `.png`, `.charx` ou `.json` e de URLs `realm.risuai.net`.\nSuporta recursos CCv3, incluindo ativos incorporados e lorebooks.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://risuai.net/',
			tags: ['risu', 'cartão de personagem', 'ccv3', 'importar']
		},
		'ru-RU': {
			name: 'Импортер RisuAI',
			avatar: 'https://risuai.net/favicon.png',
			description: 'Импортирует карточки персонажей Risu (V3) в формате .png, .charx или .json, а также с URL-адресов realm.risuai.net.',
			description_markdown: 'Импортирует карточки персонажей Risu (V3) в формате `.png`, `.charx` или `.json`, а также с URL-адресов `realm.risuai.net`.\nПоддерживает функции CCv3, включая встроенные ресурсы и книги знаний.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://risuai.net/',
			tags: ['risu', 'карточка персонажа', 'ccv3', 'импорт']
		},
		'uk-UA': {
			name: 'Імпортер RisuAI',
			avatar: 'https://risuai.net/favicon.png',
			description: 'Імпортує картки персонажів Risu (V3) у форматі .png, .charx або .json, а також з URL-адрес realm.risuai.net.',
			description_markdown: 'Імпортує картки персонажів Risu (V3) у форматі `.png`, `.charx` або `.json`, а також з URL-адрес `realm.risuai.net`.\nПідтримує функції CCv3, включаючи вбудовані ресурси та книги знань.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://risuai.net/',
			tags: ['risu', 'картка персонажа', 'ccv3', 'імпорт']
		},
		'vi-VN': {
			name: 'Trình nhập RisuAI',
			avatar: 'https://risuai.net/favicon.png',
			description: 'Nhập thẻ nhân vật Risu (V3) ở định dạng .png, .charx hoặc .json và từ các URL realm.risuai.net.',
			description_markdown: 'Nhập thẻ nhân vật Risu (V3) ở định dạng `.png`, `.charx` hoặc `.json` và từ các URL `realm.risuai.net`.\nHỗ trợ các tính năng CCv3 bao gồm tài sản nhúng và sách truyền thuyết.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://risuai.net/',
			tags: ['risu', 'thẻ nhân vật', 'ccv3', 'nhập']
		},
		'zh-TW': {
			name: 'RisuAI 匯入器',
			avatar: 'https://risuai.net/favicon.png',
			description: '匯入 Risu 角色卡 (V3) 的 .png, .charx, 或 .json 格式檔案，以及 realm.risuai.net 的網址。',
			description_markdown: '匯入 Risu 角色卡 (V3) 的 `.png`, `.charx`, 或 `.json` 格式檔案，以及 `realm.risuai.net` 的網址。\n支援 CCv3 功能，包括內嵌資源和 lorebooks。',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://risuai.net/',
			tags: ['risu', '角色卡', 'ccv3', '匯入']
		}
	},
	interfaces: {
		import: {
			ImportAsData,
			ImportByText,
		}
	}
}
