/**
 * Steam 非 Steam 游戏：探测安装、按需渲染 imgs 图、读写 shortcuts.vdf。
 */
/* global Deno */
import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { nicerWriteFileSync } from '../../src/scripts/nicerWriteFile.mjs'

import {
	isSteamGridFile,
	ShortcutsFile,
	steamGridFilenames,
	steamShortcutAppId,
} from './steam_vdf.mjs'

const APP_NAME = 'fount'
const STATUS_PREFIX = 'FOUNT_STEAM:'

/** Steam 英雄图尺寸。 */
export const STEAM_HERO = { width: 1920, height: 620 }
/** Steam 库竖封面。 */
export const STEAM_PORTRAIT = { width: 600, height: 900 }
/** Steam 库横封面。 */
export const STEAM_LANDSCAPE = { width: 920, height: 430 }
/** Steam 图标尺寸。 */
export const STEAM_ICON = { width: 256, height: 256 }
/** Steam 标题/Logo 渲染宽度（高度随 SVG 比例）。 */
export const STEAM_LOGO_WIDTH = 1280

/**
 * 给 stdout 一行状态，供 path CLI 解析。
 * @param {object} payload 状态对象
 * @returns {void}
 */
export function emitSteamStatus(payload) {
	console.log(STATUS_PREFIX + JSON.stringify(payload))
}

/**
 * 去掉 Steam 字段里常见的包围引号。
 * @param {string} value 原始字段
 * @returns {string} 去引号后的路径
 */
export function unquoteSteamPath(value) {
	const text = value.trim()
	if (text.length >= 2 && text.startsWith('"') && text.endsWith('"'))
		return text.slice(1, -1)
	return text
}

/**
 * Steam shortcuts.vdf 的 Exe/StartDir 用引号包路径。
 * @param {string} value 绝对路径
 * @param {string} [platform] 平台；Windows 把斜杠换成反斜杠
 * @returns {string} 带引号的路径
 */
export function quoteSteamPath(value, platform = process.platform) {
	const normalized = platform === 'win32' ? value.replaceAll('/', '\\') : value
	if (normalized.startsWith('"') && normalized.endsWith('"')) return normalized
	return `"${normalized}"`
}

/**
 * @param {string} left 路径
 * @param {string} right 路径
 * @returns {boolean} 是否同一路径
 */
function pathsEqual(left, right) {
	const resolvedLeft = resolve(unquoteSteamPath(left))
	const resolvedRight = resolve(unquoteSteamPath(right))
	return process.platform === 'win32' ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase() : resolvedLeft === resolvedRight
}

/**
 * @param {string} svgTag `<svg ...>` 开标签
 * @param {string} name 属性名
 * @param {string | number} value 属性值
 * @returns {string} 替换或插入后的标签
 */
function setSvgAttr(svgTag, name, value) {
	const pattern = new RegExp(`\\b${name}="[^"]*"`)
	if (pattern.test(svgTag)) return svgTag.replace(pattern, `${name}="${value}"`)
	return svgTag.replace('<svg', `<svg ${name}="${value}"`)
}

/**
 * 按目标宽高比居中裁剪 SVG viewBox，并写上输出宽高。
 * @param {string} svg 原始 SVG 文本
 * @param {number} width 目标宽度
 * @param {number} height 目标高度
 * @returns {string} 改写后的 SVG
 */
export function cropSvgToAspect(svg, width, height) {
	const open = svg.match(/<svg\b[^>]*>/)
	if (!open) return svg
	const tag = open[0]
	const viewBoxAttr = /viewBox="([^"]+)"/.exec(tag)
	const widthAttr = /width="([^"]+)"/.exec(tag)
	const heightAttr = /height="([^"]+)"/.exec(tag)
	let viewX = 0
	let viewY = 0
	let viewWidth = Number(widthAttr?.[1]) || width
	let viewHeight = Number(heightAttr?.[1]) || height
	if (viewBoxAttr) {
		const parts = viewBoxAttr[1].trim().split(/[\s,]+/).map(Number)
		viewX = parts[0]
		viewY = parts[1]
		viewWidth = parts[2]
		viewHeight = parts[3]
	}
	const targetAspect = width / height
	const sourceAspect = viewWidth / viewHeight
	if (sourceAspect > targetAspect) {
		const nextWidth = viewHeight * targetAspect
		viewX += (viewWidth - nextWidth) / 2
		viewWidth = nextWidth
	}
	else if (sourceAspect < targetAspect) {
		const nextHeight = viewWidth / targetAspect
		viewY += (viewHeight - nextHeight) / 2
		viewHeight = nextHeight
	}
	const next = setSvgAttr(setSvgAttr(setSvgAttr(tag, 'width', width), 'height', height), 'viewBox', `${viewX} ${viewY} ${viewWidth} ${viewHeight}`)
	return svg.replace(tag, next)
}

/**
 * Steam 启动路径：Windows 用根目录 fount.exe，其它平台用 path/fount。
 * @param {string} fountDir 安装根目录
 * @param {string} [platform] 平台
 * @returns {{ exe: string, startDir: string, exePath: string }} 带引号的字段与未引号 exe 路径
 */
export function steamLaunchPaths(fountDir, platform = process.platform) {
	const root = resolve(fountDir)
	const exePath = platform === 'win32' ? join(root, 'fount.exe') : join(root, 'path', 'fount')
	const startDir = root.endsWith(sep) ? root : root + sep
	return {
		exePath,
		exe: quoteSteamPath(exePath, platform),
		startDir: quoteSteamPath(startDir, platform),
	}
}

/**
 * 是否为本安装目录的启动器。
 * @param {string} exePath 已 resolve 的 exe
 * @param {string} fountDir 安装根
 * @returns {boolean} 是则 true
 */
function isFountLauncher(exePath, fountDir) {
	const root = resolve(fountDir)
	return pathsEqual(exePath, join(root, 'fount.exe'))
		|| pathsEqual(exePath, join(root, 'path', 'fount'))
		|| pathsEqual(exePath, join(root, 'path', 'fount.ps1'))
		|| pathsEqual(exePath, join(root, 'path', 'fount.sh'))
}

/**
 * 条目是否属于这一份 fount 安装。
 * @param {{ appName: string, exe: string, startDir: string }} entry 快捷方式条目
 * @param {string} fountDir 安装根
 * @returns {boolean} 是则 true
 */
export function isFountEntry(entry, fountDir) {
	if (isFountLauncher(resolve(unquoteSteamPath(entry.exe)), fountDir)) return true
	return entry.appName === APP_NAME && pathsEqual(resolve(unquoteSteamPath(entry.startDir)), fountDir)
}

/**
 * @param {string} pngPath PNG 路径
 * @param {string} svgPath SVG 路径
 * @returns {Promise<boolean>} PNG 已是 SVG 的新鲜产物
 */
async function pngIsFresh(pngPath, svgPath) {
	try {
		const [pngStat, svgStat] = await Promise.all([stat(pngPath), stat(svgPath)])
		return pngStat.size > 0 && pngStat.mtimeMs >= svgStat.mtimeMs
	}
	catch {
		return false
	}
}

/**
 * 按需把 SVG 渲成 PNG。
 * @param {object} options 选项
 * @param {string} options.svgPath SVG
 * @param {string} options.pngPath PNG
 * @param {number} options.width 宽度
 * @param {number} [options.height] 高度；有则裁剪 viewBox
 * @returns {Promise<string>} PNG 路径
 */
export async function renderSvgToPng({ svgPath, pngPath, width, height }) {
	if (await pngIsFresh(pngPath, svgPath)) return pngPath
	const { Resvg } = await import('npm:@resvg/resvg-js')
	let svg = await readFile(svgPath, 'utf8')
	if (height) svg = cropSvgToAspect(svg, width, height).replaceAll('currentColor', '#426780')
	const png = Buffer.from(new Resvg(svg, {
		fitTo: { mode: 'width', value: width },
	}).render().asPng())
	nicerWriteFileSync(pngPath, png)
	return pngPath
}

/**
 * 按需从 imgs 生成 Steam 英雄图、标题图、图标。
 * @param {string} imgsDir imgs 目录
 * @returns {Promise<{ hero: string, logo: string, icon: string, portrait: string, landscape: string }>} PNG 路径
 */
export async function ensureSteamImages(imgsDir) {
	const steamDir = join(imgsDir, 'steam')
	await mkdir(steamDir, { recursive: true })
	const back = join(imgsDir, 'icon_back.svg')
	const hero = await renderSvgToPng({
		svgPath: back,
		pngPath: join(steamDir, 'hero.png'),
		width: STEAM_HERO.width,
		height: STEAM_HERO.height,
	})
	const portrait = await renderSvgToPng({
		svgPath: back,
		pngPath: join(steamDir, 'portrait.png'),
		width: STEAM_PORTRAIT.width,
		height: STEAM_PORTRAIT.height,
	})
	const landscape = await renderSvgToPng({
		svgPath: back,
		pngPath: join(steamDir, 'landscape.png'),
		width: STEAM_LANDSCAPE.width,
		height: STEAM_LANDSCAPE.height,
	})
	const logo = await renderSvgToPng({
		svgPath: join(imgsDir, 'title.svg'),
		pngPath: join(steamDir, 'logo.png'),
		width: STEAM_LOGO_WIDTH,
	})
	const icon = await renderSvgToPng({
		svgPath: join(imgsDir, 'icon.svg'),
		pngPath: join(steamDir, 'icon.png'),
		width: STEAM_ICON.width,
		height: STEAM_ICON.height,
	})
	return { hero, logo, icon, portrait, landscape }
}

/**
 * 查 Windows 注册表里的 Steam 安装路径。
 * @returns {Promise<string | undefined>} Steam 根目录
 */
export async function queryWindowsSteamPath() {
	try {
		const { code, stdout } = await new Deno.Command('reg', {
			args: ['query', 'HKCU\\SOFTWARE\\Valve\\Steam', '/v', 'SteamPath'],
			stdout: 'piped',
			stderr: 'piped',
		}).output()
		if (code) return
		const text = new TextDecoder().decode(stdout)
		const match = /SteamPath\s+REG_\w+\s+(.+)/.exec(text)
		const steamPath = match?.[1].trim()
		return steamPath || undefined
	}
	catch {
		return
	}
}

/**
 * Unix / macOS 常见 Steam 根目录。
 * @param {string} home 用户目录
 * @returns {string[]} 候选路径
 */
export function unixSteamCandidates(home) {
	return [
		join(home, '.steam/steam'),
		join(home, '.local/share/Steam'),
		join(home, 'snap/steam'),
		join(home, '.var/app/com.valvesoftware.Steam/.steam/steam'),
		join(home, 'Library/Application Support/Steam'),
	]
}

/**
 * 探测本机 Steam 安装根目录。
 * @param {object} [options] 可注入探测
 * @param {string} [options.platform] 平台
 * @param {string} [options.home] 家目录
 * @param {() => Promise<string | undefined>} [options.windowsSteamPath] Windows 探测
 * @returns {Promise<string[]>} 存在的 Steam 根目录
 */
export async function findSteamInstallPaths({
	platform = process.platform,
	home = homedir(),
	windowsSteamPath = queryWindowsSteamPath,
} = {}) {
	if (platform === 'win32') {
		const steamPath = await windowsSteamPath()
		return steamPath && existsSync(steamPath) ? [steamPath] : []
	}
	return unixSteamCandidates(home).filter(candidate => existsSync(candidate))
}

/**
 * 列出某 Steam 根下的用户 config 目录。
 * @param {string} steamPath Steam 根
 * @returns {Promise<Array<{ userId: string, steamPath: string, config: string, shortcuts: string, grid: string }>>} 用户库
 */
export async function listSteamUserConfigs(steamPath) {
	const userdata = join(steamPath, 'userdata')
	if (!existsSync(userdata)) return []
	const users = []
	for (const name of await readdir(userdata)) {
		if (!/^\d+$/.test(name)) continue
		const config = join(userdata, name, 'config')
		if (!existsSync(config)) continue
		users.push({
			userId: name,
			steamPath,
			config,
			shortcuts: join(config, 'shortcuts.vdf'),
			grid: join(config, 'grid'),
		})
	}
	return users
}

/**
 * 本机全部 Steam 用户库。
 * @param {Parameters<typeof findSteamInstallPaths>[0]} [options] 探测选项
 * @returns {Promise<Awaited<ReturnType<typeof listSteamUserConfigs>>>} 用户库列表
 */
export async function findSteamLibraries(options) {
	const installs = await findSteamInstallPaths(options)
	const users = []
	for (const steamPath of installs)
		users.push(...await listSteamUserConfigs(steamPath))
	return users
}

/**
 * 在 shortcuts 里加入或更新本安装的 fount 条目。
 * @param {ShortcutsFile} shortcuts shortcuts
 * @param {object} options 选项
 * @param {string} options.fountDir 安装根
 * @param {string} options.exe 带引号 exe
 * @param {string} options.startDir 带引号工作目录
 * @returns {{ appId: number, action: 'added' | 'updated', oldAppIds: number[] }} 条目
 */
export function applyFountSteamEntry(shortcuts, { fountDir, exe, startDir }) {
	return shortcuts.upsert(entry => isFountEntry(entry, fountDir), {
		appId: steamShortcutAppId(exe, APP_NAME),
		appName: APP_NAME,
		exe,
		startDir,
		allowOverlay: true,
		allowDesktopConfig: true,
	})
}

/**
 * 把封面/英雄图/标题图/图标拷进该用户的 grid 目录。
 * @param {string} gridDir grid 目录
 * @param {number} appId 条目 ID
 * @param {{ hero: string, logo: string, icon: string, portrait: string, landscape: string }} images PNG
 * @returns {Promise<string>} 图标目标路径
 */
export async function copySteamImages(gridDir, appId, images) {
	await mkdir(gridDir, { recursive: true })
	const names = steamGridFilenames(appId)
	for (const file of await readdir(gridDir))
		if (isSteamGridFile(file, appId))
			await rm(join(gridDir, file))
	await copyFile(images.landscape, join(gridDir, names.landscape))
	await copyFile(images.portrait, join(gridDir, names.portrait))
	await copyFile(images.hero, join(gridDir, names.hero))
	await copyFile(images.logo, join(gridDir, names.logo))
	const iconDest = join(gridDir, names.icon)
	await copyFile(images.icon, iconDest)
	await copyFile(images.hero, join(gridDir, names.bigPicture))
	return iconDest
}

/**
 * 删掉该 appId 在 grid 里的自定义图。
 * @param {string} gridDir grid 目录
 * @param {number} appId 条目 ID
 * @returns {Promise<void>}
 */
export async function removeSteamImages(gridDir, appId) {
	if (!existsSync(gridDir)) return
	for (const file of await readdir(gridDir))
		if (isSteamGridFile(file, appId))
			await rm(join(gridDir, file))
}

/**
 * 加载 shortcuts.vdf；没有文件则空表。
 * @param {string} shortcutsPath vdf 路径
 * @returns {Promise<ShortcutsFile>} shortcuts
 */
export async function loadShortcutsFile(shortcutsPath) {
	return ShortcutsFile.fromBuffer(existsSync(shortcutsPath) ? await readFile(shortcutsPath) : new Uint8Array(), shortcutsPath)
}

/**
 * 写出 shortcuts.vdf。
 * @param {ShortcutsFile} shortcuts shortcuts
 * @param {string} shortcutsPath 路径
 * @returns {void}
 */
export function saveShortcutsFile(shortcuts, shortcutsPath) {
	nicerWriteFileSync(shortcutsPath, shortcuts.toBuffer())
}

/**
 * 探测 Steam。无安装或无用户库则 skip。
 * @param {object} [options] 探测选项
 * @returns {Promise<{ status: 'skip' | 'ready', users?: Awaited<ReturnType<typeof findSteamLibraries>> }>} 状态
 */
export async function probeSteam(options) {
	const users = await findSteamLibraries(options)
	if (!users.length) return { status: 'skip' }
	return { status: 'ready', users }
}

/**
 * 注册 fount 到所有 Steam 用户库。
 * @param {object} options 选项
 * @param {string} options.fountDir 安装根
 * @param {string} [options.platform] 平台
 * @param {typeof findSteamLibraries} [options.findLibraries] 探测
 * @returns {Promise<object>} 状态
 */
export async function registerFountSteam({
	fountDir,
	platform = process.platform,
	findLibraries = findSteamLibraries,
} = {}) {
	const users = await findLibraries()
	if (!users.length) return { status: 'skip' }
	const launch = steamLaunchPaths(fountDir, platform)
	if (platform === 'win32' && !existsSync(launch.exePath))
		return { status: 'need_exe', exePath: launch.exePath }
	const images = await ensureSteamImages(join(fountDir, 'imgs'))
	const appIds = []
	let action = 'updated'
	for (const user of users) {
		const shortcuts = await loadShortcutsFile(user.shortcuts)
		const applied = applyFountSteamEntry(shortcuts, {
			fountDir,
			exe: launch.exe,
			startDir: launch.startDir,
		})
		if (applied.action === 'added') action = 'added'
		for (const oldId of applied.oldAppIds)
			await removeSteamImages(user.grid, oldId)
		const icon = await copySteamImages(user.grid, applied.appId, images)
		shortcuts.editEntry(applied.appId, { icon })
		saveShortcutsFile(shortcuts, user.shortcuts)
		appIds.push(applied.appId)
	}
	return { status: 'ok', action, appIds }
}

/**
 * 从所有 Steam 用户库移除本安装的 fount。
 * @param {object} options 选项
 * @param {string} options.fountDir 安装根
 * @param {typeof findSteamLibraries} [options.findLibraries] 探测
 * @returns {Promise<object>} 状态
 */
export async function unregisterFountSteam({
	fountDir,
	findLibraries = findSteamLibraries,
} = {}) {
	const users = await findLibraries()
	if (!users.length) return { status: 'skip' }
	let removed = 0
	for (const user of users) {
		if (!existsSync(user.shortcuts)) continue
		const shortcuts = await loadShortcutsFile(user.shortcuts)
		const matches = shortcuts.entries.filter(entry => isFountEntry(entry, fountDir))
		if (!matches.length) continue
		for (const entry of matches) {
			shortcuts.deleteEntry(entry.appId)
			await removeSteamImages(user.grid, entry.appId)
			removed++
		}
		saveShortcutsFile(shortcuts, user.shortcuts)
	}
	return { status: 'ok', action: removed ? 'removed' : 'absent', removed }
}

/**
 * CLI：probe / register / unregister。
 * @param {string[]} args Deno.args
 * @returns {Promise<void>}
 */
export async function main(args = Deno.args) {
	const [action = 'probe', fountDirArg] = args
	const fountDir = resolve(fountDirArg || join(dirname(fileURLToPath(import.meta.url)), '../..'))
	try {
		if (action === 'probe') {
			const result = await probeSteam()
			emitSteamStatus(result.status === 'skip' ? { status: 'skip' } : { status: 'ready' })
			return
		}
		if (action === 'register') {
			emitSteamStatus(await registerFountSteam({ fountDir }))
			return
		}
		if (action === 'unregister') {
			emitSteamStatus(await unregisterFountSteam({ fountDir }))
			return
		}
		emitSteamStatus({ status: 'error', message: `unknown action: ${action}` })
	}
	catch (error) {
		emitSteamStatus({ status: 'error', message: error?.stack || error?.message || String(error) })
	}
}

if (import.meta.main) await main()
