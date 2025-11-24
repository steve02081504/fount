import { existsSync } from 'node:fs'
import { mkdir, rm, stat, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import url from 'node:url'

import { move, remove } from 'npm:fs-extra'

import { run_git } from '../../../scripts/git.mjs'
import { loadJsonFile } from '../../../scripts/json_loader.mjs'
import { loadPart } from '../../../server/managers/index.mjs'
import { isPartLoaded } from '../../../server/parts_loader.mjs'

import { cloneRepo } from './git.mjs'
import { getAvailablePath } from './path.mjs'
import { isFountPart, unzipDirectory } from './zip.mjs'


/**
 * 合并移动文件或目录。
 * @param {string} src - 源路径。
 * @param {string} dest - 目标路径。
 * @returns {Promise<void>}
 */
async function moveWithMerge(src, dest) {
	if (!existsSync(dest)) return await move(src, dest)

	const srcStat = await stat(src)
	const destStat = await stat(dest)

	// Source is a file
	if (srcStat.isFile())
		if (destStat.isFile())
			await move(src, dest, { overwrite: true })
		else
			throw new Error(`Cannot move file to directory: ${dest}`)
	// Source is a directory
	else if (srcStat.isDirectory())
		if (destStat.isDirectory())
			await mergeDirectories(src, dest)
		else
			throw new Error(`Cannot move directory to file: ${dest}`)
}

/**
 * 合并目录。
 * @param {string} srcDir - 源目录。
 * @param {string} destDir - 目标目录。
 * @returns {Promise<void>}
 */
async function mergeDirectories(srcDir, destDir) {
	const items = await readdir(srcDir)
	for (const item of items) {
		const srcPath = path.join(srcDir, item)
		const destPath = path.join(destDir, item)
		const srcStat = await stat(srcPath)

		if (srcStat.isFile())
			await move(srcPath, destPath, { overwrite: true })
		else if (srcStat.isDirectory())
			if (!existsSync(destPath))
				await move(srcPath, destPath)
			else
				await mergeDirectories(srcPath, destPath)
	}
	await remove(srcDir)
}

/**
 * 将数据作为 fount 部件导入。
 * @param {string} username - 用户名。
 * @param {Buffer} data - 数据缓冲区。
 * @returns {Promise<Array<{ parttype: string; partname: string }>>} - 导入的部分信息数组。
 */
async function ImportAsData(username, data) {
	if (!await isFountPart(data)) throw new Error('Invalid fount part: no fount.json found')
	const tempDir = path.join(tmpdir(), 'fount_import_' + Date.now())
	await mkdir(tempDir, { recursive: true })
	try {
		await unzipDirectory(data, tempDir)
	}
	catch (err) {
		console.error('Unzip failed:', err)
		await rm(tempDir, { recursive: true, force: true })
		throw new Error(`Unzip failed: ${err.stack || err}`)
	}
	try {
		const metaPath = path.join(tempDir, 'fount.json')
		/**
		 * @type {{type: string, dirname: string, data_files: string[]}}
		 */
		const meta = await loadJsonFile(metaPath)
		const needsReload = isPartLoaded(username, meta.type, meta.dirname)
		const targetPath = await getAvailablePath(username, meta.type, meta.dirname)
		meta.data_files ??= []
		if (existsSync(targetPath)) {
			const files = await readdir(targetPath)
			for (const file of files)
				if (!meta.data_files.includes(file))
					await rm(path.join(targetPath, file), { recursive: true, force: true })
		}
		await moveWithMerge(tempDir, targetPath)
		if (needsReload)
			loadPart(username, meta.type, meta.dirname)
		else
			import(url.pathToFileURL(path.join(targetPath, 'main.mjs'))).catch(x => x)
		return [{ parttype: meta.type, partname: meta.dirname }]
	}
	catch (err) {
		await rm(tempDir, { recursive: true, force: true }).catch(x => x)
		throw new Error(`loadMeta failed: ${err.message || err}`)
	}
}

/**
 * 通过文本导入 fount 部件。
 * @param {string} username - 用户名。
 * @param {string} text - 包含部件 URL 的文本。
 * @returns {Promise<Array<{ parttype: string; partname: string }>>} - 导入的部分信息数组。
 */
async function ImportByText(username, text) {
	const lines = text.trim().split('\n').map(line => line.trim()).filter(line => line)
	const installedParts = []
	for (const line of lines)
		if (line.startsWith('http')) {
			const errors = []
			if (line.match(/\/\/git/i) || line.match(/.git(#.*|)$/i)) {
				const tempDir = path.join(tmpdir(), 'fount_import_git_' + Date.now())
				try {
					await cloneRepo(line, tempDir)
					const metaPath = path.join(tempDir, 'fount.json')
					/**
					 * @type {{type: string, dirname: string, data_files: string[]}}
					 */
					const meta = await loadJsonFile(metaPath)
					const needsReload = isPartLoaded(username, meta.type, meta.dirname)
					const targetPath = await getAvailablePath(username, meta.type, meta.dirname)
					meta.data_files ??= []
					if (existsSync(targetPath)) {
						const files = await readdir(targetPath)
						for (const file of files)
							if (!meta.data_files.includes(file))
								await rm(path.join(targetPath, file), { recursive: true, force: true })
					}
					await moveWithMerge(tempDir, targetPath)
					const git = run_git.withPath(targetPath)
					await git('config core.autocrlf false')
					const remoteBranch = await git('rev-parse --abbrev-ref --symbolic-full-name "@{u}"')
					await git('fetch origin')
					await git('reset --hard ' + remoteBranch)
					if (needsReload)
						loadPart(username, meta.type, meta.dirname)
					else
						import(url.pathToFileURL(path.join(targetPath, 'main.mjs'))).catch(x => x)
					installedParts.push({ parttype: meta.type, partname: meta.dirname })
					continue
				}
				catch (err) {
					errors.push(err)
					console.error(`Git clone failed for ${line}:`, err)
				}
				await rm(tempDir, { recursive: true, force: true }).catch(x => x)
			}
			// Try importing as a file
			try {
				// Send HEAD request to get file type; skip if not zip/png/apng/jpng
				let request = await fetch(line, { method: 'HEAD' })
				if (request.ok) {
					const type = request.headers.get('content-type')
					const allowedTypes = ['application/octet-stream', 'application/zip', 'application/x-7z-compressed', 'image/png', 'image/apng', 'image/jpng']
					if (!allowedTypes.includes(type))
						throw new Error(`Unsupported file type: ${type}`)
				}
				request = await fetch(line)
				if (request.ok) {
					const buffer = await request.arrayBuffer()
					installedParts.push(...await ImportAsData(username, buffer))
					continue
				}
			} catch (err) { errors.push(err) }
			throw new Error(`Failed to import from ${line}: ${errors.map(err => err.stack || err).join('\n')}`)
		}
	return installedParts
}

/**
 * fount 导入器模块定义。
 */
export default {
	info: {
		'en-UK': {
			name: 'fount Importer',
			avatar: '/favicon.svg',
			description: 'Imports fount parts from archive files or git repositories.',
			description_markdown: 'Imports fount parts from archive files (e.g., `.zip`, `.7z`) or git repositories.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://steve02081504.github.io/fount/',
			tags: ['fount', 'part', 'import']
		},
		'zh-CN': {
			name: 'fount 导入器',
			avatar: '/favicon.svg',
			description: '从压缩文件或 git 仓库导入 fount 部件。',
			description_markdown: '从压缩文件 (例如 `.zip`, `.7z`) 或 git 仓库导入 fount 部件。',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://steve02081504.github.io/fount/',
			tags: ['fount', '部件', '导入']
		},
		'ar-SA': {
			name: 'مستورد fount',
			avatar: '/favicon.svg',
			description: 'يستورد أجزاء fount من ملفات الأرشيف أو مستودعات git.',
			description_markdown: 'يستورد أجزاء fount من ملفات الأرشيف (مثل `.zip`، `.7z`) أو مستودعات git.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://steve02081504.github.io/fount/',
			tags: ['fount', 'جزء', 'استيراد']
		},
		'de-DE': {
			name: 'fount-Importer',
			avatar: '/favicon.svg',
			description: 'Importiert fount-Teile aus Archivdateien oder Git-Repositorys.',
			description_markdown: 'Importiert fount-Teile aus Archivdateien (z. B. `.zip`, `.7z`) oder Git-Repositorys.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://steve02081504.github.io/fount/',
			tags: ['fount', 'Teil', 'Import']
		},
		emoji: {
			name: '⛲ fount Importer',
			avatar: '/favicon.svg',
			description: 'Imports fount parts from archive files or git repositories.',
			description_markdown: 'Imports fount parts from archive files (e.g., `.zip`, `.7z`) or git repositories.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://steve02081504.github.io/fount/',
			tags: ['fount', 'part', 'import']
		},
		'es-ES': {
			name: 'Importador de fount',
			avatar: '/favicon.svg',
			description: 'Importa partes de fount desde archivos de almacenamiento o repositorios de git.',
			description_markdown: 'Importa partes de fount desde archivos de almacenamiento (por ejemplo, `.zip`, `.7z`) o repositorios de git.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://steve02081504.github.io/fount/',
			tags: ['fount', 'parte', 'importar']
		},
		'fr-FR': {
			name: 'Importateur de fount',
			avatar: '/favicon.svg',
			description: 'Importe des pièces de fount à partir de fichiers d\'archive ou de référentiels git.',
			description_markdown: 'Importe des pièces de fount à partir de fichiers d\'archive (par exemple, `.zip`, `.7z`) ou de référentiels git.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://steve02081504.github.io/fount/',
			tags: ['fount', 'pièce', 'importer']
		},
		'hi-IN': {
			name: 'fount आयातक',
			avatar: '/favicon.svg',
			description: 'संग्रह फ़ाइलों या git रिपॉजिटरी से fount भागों का आयात करता है।',
			description_markdown: 'संग्रह फ़ाइलों (उदाहरण के लिए, `.zip`, `.7z`) या git रिपॉजिटरी से fount भागों का आयात करता है।',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://steve02081504.github.io/fount/',
			tags: ['fount', 'भाग', 'आयात']
		},
		'is-IS': {
			name: 'fount innflytjandi',
			avatar: '/favicon.svg',
			description: 'Flytur inn fount hluta úr skjalasafnsskrám eða git geymslum.',
			description_markdown: 'Flytur inn fount hluta úr skjalasafnsskrám (t.d. `.zip`, `.7z`) eða git geymslum.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://steve02081504.github.io/fount/',
			tags: ['fount', 'hluti', 'innflutningur']
		},
		'it-IT': {
			name: 'Importatore di fount',
			avatar: '/favicon.svg',
			description: 'Importa parti di fount da file di archivio o repository git.',
			description_markdown: 'Importa parti di fount da file di archivio (ad es. `.zip`, `.7z`) o repository git.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://steve02081504.github.io/fount/',
			tags: ['fount', 'parte', 'importa']
		},
		'ja-JP': {
			name: 'fount インポーター',
			avatar: '/favicon.svg',
			description: 'アーカイブファイルまたはgitリポジトリからfountパーツをインポートします。',
			description_markdown: 'アーカイブファイル（`.zip`、`.7z`など）またはgitリポジトリからfountパーツをインポートします。',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://steve02081504.github.io/fount/',
			tags: ['fount', 'パーツ', 'インポート']
		},
		'ko-KR': {
			name: 'fount 가져오기',
			avatar: '/favicon.svg',
			description: '아카이브 파일 또는 git 리포지토리에서 fount 파트를 가져옵니다.',
			description_markdown: '아카이브 파일(예: `.zip`, `.7z`) 또는 git 리포지토리에서 fount 파트를 가져옵니다.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://steve02081504.github.io/fount/',
			tags: ['fount', '파트', '가져오기']
		},
		lzh: {
			name: 'fount 納入司',
			avatar: '/favicon.svg',
			description: '自封存檔或 git 倉庫納入 fount 部件。',
			description_markdown: '自封存檔（如 `.zip`、`.7z`）或 git 倉庫納入 fount 部件。',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://steve02081504.github.io/fount/',
			tags: ['fount', '部件', '納入']
		},
		'nl-NL': {
			name: 'fount-importeur',
			avatar: '/favicon.svg',
			description: 'Importeert fount-onderdelen uit archiefbestanden of git-repository\'s.',
			description_markdown: 'Importeert fount-onderdelen uit archiefbestanden (bijv. `.zip`, `.7z`) of git-repository\'s.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://steve02081504.github.io/fount/',
			tags: ['fount', 'onderdeel', 'importeren']
		},
		'pt-PT': {
			name: 'Importador de fount',
			avatar: '/favicon.svg',
			description: 'Importa peças de fount de arquivos de pacote ou repositórios git.',
			description_markdown: 'Importa peças de fount de arquivos de pacote (por exemplo, `.zip`, `.7z`) ou repositórios git.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://steve02081504.github.io/fount/',
			tags: ['fount', 'peça', 'importar']
		},
		'ru-RU': {
			name: 'Импортер fount',
			avatar: '/favicon.svg',
			description: 'Импортирует детали fount из архивных файлов или репозиториев git.',
			description_markdown: 'Импортирует детали fount из архивных файлов (например, `.zip`, `.7z`) или репозиториев git.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://steve02081504.github.io/fount/',
			tags: ['fount', 'деталь', 'импорт']
		},
		'uk-UA': {
			name: 'Імпортер fount',
			avatar: '/favicon.svg',
			description: 'Імпортує деталі fount з архівних файлів або репозиторіїв git.',
			description_markdown: 'Імпортує деталі fount з архівних файлів (наприклад, `.zip`, `.7z`) або репозиторіїв git.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://steve02081504.github.io/fount/',
			tags: ['fount', 'деталь', 'імпорт']
		},
		'vi-VN': {
			name: 'Trình nhập fount',
			avatar: '/favicon.svg',
			description: 'Nhập các bộ phận fount từ tệp lưu trữ hoặc kho git.',
			description_markdown: 'Nhập các bộ phận fount từ tệp lưu trữ (ví dụ: `.zip`, `.7z`) hoặc kho git.',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://steve02081504.github.io/fount/',
			tags: ['fount', 'bộ phận', 'nhập']
		},
		'zh-TW': {
			name: 'fount 匯入器',
			avatar: '/favicon.svg',
			description: '從壓縮檔案或 git 倉庫匯入 fount 部件。',
			description_markdown: '從壓縮檔案 (例如 `.zip`, `.7z`) 或 git 倉庫匯入 fount 部件。',
			version: '0.0.0',
			author: 'steve02081504',
			home_page: 'https://steve02081504.github.io/fount/',
			tags: ['fount', '部件', '匯入']
		}
	},

	interfaces: {
		import: {
			ImportAsData,
			ImportByText,
		}
	}
}
