import { Buffer } from 'node:buffer'
import path from 'node:path'

import fs from 'npm:fs-extra'
import sanitizeFilename from 'npm:sanitize-filename'

import { saveJsonFile } from '../../../scripts/json_loader.mjs'

import { downloadCharacter } from './char-download.mjs'
import data_reader from './data_reader.mjs'
import { GetV2CharDataFromV1 } from './engine/charData.mjs'
import { getAvailablePath } from './path.mjs'

/**
 * 将对象中的 `\r\n` 和 `\r` 替换为 `\n`。
 * @param {any} obj - 要处理的对象。
 * @returns {any} - 处理后的对象。
 */
function RN2N(obj) {
	if (!obj) return obj
	if (Object(obj) instanceof String)
		return obj.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
	else if (Array.isArray(obj))
		return obj.map(RN2N)
	else if (Object(obj) instanceof Number || Object(obj) instanceof Boolean)
		return obj
	else
		return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, RN2N(v)]))
}

/**
 * 将数据作为 SillyTavern 角色导入。
 * @param {string} username - 用户名。
 * @param {Buffer} data - 数据缓冲区。
 * @returns {Promise<Array<{ parttype: string; partname: string }>>} - 导入的部分信息数组。
 */
async function ImportAsData(username, data) {
	const chardata = GetV2CharDataFromV1(RN2N(JSON.parse(data_reader.read(data))))

	// make an dir for the character
	// copy directory
	const templateDir = path.join(import.meta.dirname, 'Template')
	const targetPath = await getAvailablePath(username, 'chars', sanitizeFilename(chardata.name || 'unknown'))

	await fs.copy(templateDir, targetPath)
	// write chardata to the character
	const chardataPath = path.join(targetPath, 'chardata.json')
	saveJsonFile(chardataPath, chardata)
	// save image to the character
	const image = data_reader.remove(data)
	const publicDir = path.join(targetPath, 'public')
	await fs.ensureDir(publicDir)
	const imagePath = path.join(publicDir, 'image.png')
	await fs.writeFile(imagePath, image)
	return [{ parttype: 'chars', partname: chardata.name }]
}

/**
 * 通过文本导入 SillyTavern 角色。
 * @param {string} username - 用户名。
 * @param {string} text - 包含角色 URL 的文本。
 * @returns {Promise<Array<{ parttype: string; partname: string }>>} - 导入的部分信息数组。
 */
async function ImportByText(username, text) {
	const lines = text.split('\n').filter(line => line)
	const importedParts = []
	for (const line of lines)
		if (line.startsWith('http')) {
			const arrayBuffer = await downloadCharacter(line)
			const buffer = Buffer.from(arrayBuffer)
			importedParts.push(...await ImportAsData(username, buffer))
		}
	return importedParts
}

/**
 * @type {import('../../../decl/import.ts').import_handler_t}
 */
export default {
	info: {
		'en-UK': {
			name: 'SillyTavern Importer',
			avatar: 'https://sillytavern.app/img/logo.png',
			description: 'Imports SillyTavern characters from .png files or URLs.',
			description_markdown: 'Imports SillyTavern characters from `.png` files or URLs from character sharing sites.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://sillytavern.app/',
			tags: ['sillytavern', 'character card', 'import']
		},
		'zh-CN': {
			name: 'SillyTavern 导入器',
			avatar: 'https://sillytavern.app/img/logo.png',
			description: '从 .png 文件或网址导入 SillyTavern 角色。',
			description_markdown: '从 `.png` 文件或角色分享网站的网址导入 SillyTavern 角色。',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://sillytavern.app/',
			tags: ['sillytavern', '角色卡', '导入']
		},
		'ar-SA': {
			name: 'مستورد SillyTavern',
			avatar: 'https://sillytavern.app/img/logo.png',
			description: 'يستورد شخصيات SillyTavern من ملفات .png أو عناوين URL.',
			description_markdown: 'يستورد شخصيات SillyTavern من ملفات `.png` أو عناوين URL من مواقع مشاركة الشخصيات.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://sillytavern.app/',
			tags: ['sillytavern', 'بطاقة شخصية', 'استيراد']
		},
		'de-DE': {
			name: 'SillyTavern-Importer',
			avatar: 'https://sillytavern.app/img/logo.png',
			description: 'Importiert SillyTavern-Charaktere aus .png-Dateien oder URLs.',
			description_markdown: 'Importiert SillyTavern-Charaktere aus `.png`-Dateien oder URLs von Charakter-Sharing-Websites.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://sillytavern.app/',
			tags: ['sillytavern', 'Charakterkarte', 'Import']
		},
		emoji: {
			name: '🤪 SillyTavern Importer',
			avatar: 'https://sillytavern.app/img/logo.png',
			description: 'Imports SillyTavern characters from .png files or URLs.',
			description_markdown: 'Imports SillyTavern characters from `.png` files or URLs from character sharing sites.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://sillytavern.app/',
			tags: ['sillytavern', 'character card', 'import']
		},
		'es-ES': {
			name: 'Importador de SillyTavern',
			avatar: 'https://sillytavern.app/img/logo.png',
			description: 'Importa personajes de SillyTavern desde archivos .png o URLs.',
			description_markdown: 'Importa personajes de SillyTavern desde archivos `.png` o URLs de sitios para compartir personajes.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://sillytavern.app/',
			tags: ['sillytavern', 'tarjeta de personaje', 'importar']
		},
		'fr-FR': {
			name: 'Importateur SillyTavern',
			avatar: 'https://sillytavern.app/img/logo.png',
			description: 'Importe des personnages SillyTavern à partir de fichiers .png ou d\'URL.',
			description_markdown: 'Importe des personnages SillyTavern à partir de fichiers `.png` ou d\'URL de sites de partage de personnages.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://sillytavern.app/',
			tags: ['sillytavern', 'carte de personnage', 'importer']
		},
		'hi-IN': {
			name: 'SillyTavern आयातक',
			avatar: 'https://sillytavern.app/img/logo.png',
			description: '.png फ़ाइलों या URL से SillyTavern वर्ण आयात करता है।',
			description_markdown: 'चरित्र साझा करने वाली साइटों से `.png` फ़ाइलों या URL से SillyTavern वर्ण आयात करता है।',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://sillytavern.app/',
			tags: ['sillytavern', 'कैरेक्टर कार्ड', 'आयात']
		},
		'is-IS': {
			name: 'SillyTavern innflytjandi',
			avatar: 'https://sillytavern.app/img/logo.png',
			description: 'Flytur inn SillyTavern stafi úr .png skrám eða vefslóðum.',
			description_markdown: 'Flytur inn SillyTavern stafi úr `.png` skrám eða vefslóðum frá persónudeilingarsíðum.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://sillytavern.app/',
			tags: ['sillytavern', 'persónukort', 'innflutningur']
		},
		'it-IT': {
			name: 'Importatore di SillyTavern',
			avatar: 'https://sillytavern.app/img/logo.png',
			description: 'Importa personaggi di SillyTavern da file .png o URL.',
			description_markdown: 'Importa personaggi di SillyTavern da file `.png` o URL da siti di condivisione di personaggi.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://sillytavern.app/',
			tags: ['sillytavern', 'scheda personaggio', 'importa']
		},
		'ja-JP': {
			name: 'SillyTavern インポーター',
			avatar: 'https://sillytavern.app/img/logo.png',
			description: '.pngファイルまたはURLからSillyTavernのキャラクターをインポートします。',
			description_markdown: 'キャラクター共有サイトから`.png`ファイルまたはURLを使用してSillyTavernのキャラクターをインポートします。',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://sillytavern.app/',
			tags: ['sillytavern', 'キャラクターカード', 'インポート']
		},
		'ko-KR': {
			name: 'SillyTavern 가져오기',
			avatar: 'https://sillytavern.app/img/logo.png',
			description: '.png 파일 또는 URL에서 SillyTavern 캐릭터를 가져옵니다.',
			description_markdown: '캐릭터 공유 사이트의 `.png` 파일 또는 URL에서 SillyTavern 캐릭터를 가져옵니다.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://sillytavern.app/',
			tags: ['sillytavern', '캐릭터 카드', '가져오기']
		},
		lzh: {
			name: 'SillyTavern 納入司',
			avatar: 'https://sillytavern.app/img/logo.png',
			description: '自 .png 畫卷或網羅之址，納 SillyTavern 角色於此。',
			description_markdown: '自 `.png` 畫卷或諸方角色分享之網羅，納 SillyTavern 角色於此。',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://sillytavern.app/',
			tags: ['sillytavern', '角色符', '納入']
		},
		'nl-NL': {
			name: 'SillyTavern-importeur',
			avatar: 'https://sillytavern.app/img/logo.png',
			description: 'Importeert SillyTavern-personages uit .png-bestanden of URL\'s.',
			description_markdown: 'Importeert SillyTavern-personages uit `.png`-bestanden of URL\'s van websites voor het delen van personages.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://sillytavern.app/',
			tags: ['sillytavern', 'personagekaart', 'importeren']
		},
		'pt-PT': {
			name: 'Importador SillyTavern',
			avatar: 'https://sillytavern.app/img/logo.png',
			description: 'Importa personagens SillyTavern de arquivos .png ou URLs.',
			description_markdown: 'Importa personagens SillyTavern de arquivos `.png` ou URLs de sites de compartilhamento de personagens.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://sillytavern.app/',
			tags: ['sillytavern', 'cartão de personagem', 'importar']
		},
		'ru-RU': {
			name: 'Импортер SillyTavern',
			avatar: 'https://sillytavern.app/img/logo.png',
			description: 'Импортирует персонажей SillyTavern из файлов .png или URL-адресов.',
			description_markdown: 'Импортирует персонажей SillyTavern из файлов `.png` или URL-адресов с сайтов обмена персонажами.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://sillytavern.app/',
			tags: ['sillytavern', 'карточка персонажа', 'импорт']
		},
		'uk-UA': {
			name: 'Імпортер SillyTavern',
			avatar: 'https://sillytavern.app/img/logo.png',
			description: 'Імпортує персонажів SillyTavern з файлів .png або URL-адрес.',
			description_markdown: 'Імпортує персонажів SillyTavern з файлів `.png` або URL-адрес із сайтів обміну персонажами.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://sillytavern.app/',
			tags: ['sillytavern', 'картка персонажа', 'імпорт']
		},
		'vi-VN': {
			name: 'Trình nhập SillyTavern',
			avatar: 'https://sillytavern.app/img/logo.png',
			description: 'Nhập các ký tự SillyTavern từ tệp .png hoặc URL.',
			description_markdown: 'Nhập các ký tự SillyTavern từ tệp `.png` hoặc URL từ các trang web chia sẻ ký tự.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://sillytavern.app/',
			tags: ['sillytavern', 'thẻ nhân vật', 'nhập']
		},
		'zh-TW': {
			name: 'SillyTavern 匯入器',
			avatar: 'https://sillytavern.app/img/logo.png',
			description: '從 .png 檔案或網址匯入 SillyTavern 角色。',
			description_markdown: '從 `.png` 檔案或角色分享網站的網址匯入 SillyTavern 角色。',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://sillytavern.app/',
			tags: ['sillytavern', '角色卡', '匯入']
		}
	},

	interfaces: {
		import: {
			ImportAsData,
			ImportByText,
		}
	}
}
