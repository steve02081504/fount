/**
 * Steam 非 Steam 注册：探测跳过、条目匹配、VDF 读写、按需渲图。
 */
/* global Deno */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, assertEquals, assertStringIncludes, assertThrows } from 'jsr:@std/assert'

import { REPO_ROOT } from '../../src/scripts/test/core/repo_root.mjs'
import {
	applyFountSteamEntry,
	copySteamImages,
	cropSvgToAspect,
	emitSteamStatus,
	ensureSteamImages,
	findSteamInstallPaths,
	isFountEntry,
	loadShortcutsFile,
	probeSteam,
	quoteSteamPath,
	registerFountSteam,
	steamLaunchPaths,
	unquoteSteamPath,
	unregisterFountSteam,
} from '../src/steam.mjs'
import {
	entryToSteam,
	parseBinaryVdf,
	ShortcutsFile,
	steamShortcutAppId,
	writeBinaryVdf,
} from '../src/steam_vdf.mjs'

const TINY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="#135"/></svg>'

/**
 * 假 Steam userdata + 带 imgs 的 fount 根。
 * @returns {Promise<{ root: string, fountDir: string, user: object }>} 临时树
 */
async function makeSteamHarness() {
	const root = await mkdtemp(join(tmpdir(), 'fount-steam-'))
	const fountDir = join(root, 'fount')
	const imgs = join(fountDir, 'imgs')
	const config = join(root, 'steam', 'userdata', '99', 'config')
	await mkdir(imgs, { recursive: true })
	await mkdir(config, { recursive: true })
	await writeFile(join(imgs, 'icon_back.svg'), TINY_SVG)
	await writeFile(join(imgs, 'title.svg'), TINY_SVG)
	await writeFile(join(imgs, 'icon.svg'), TINY_SVG)
	const user = {
		userId: '99',
		steamPath: join(root, 'steam'),
		config,
		shortcuts: join(config, 'shortcuts.vdf'),
		grid: join(config, 'grid'),
	}
	return { root, fountDir, user }
}

/**
 * 在临时 Steam 树里跑 callback，结束后删掉根目录。
 * @param {(harness: Awaited<ReturnType<typeof makeSteamHarness>>) => Promise<void>} callback 测试体
 * @returns {Promise<void>}
 */
async function withSteamHarness(callback) {
	const harness = await makeSteamHarness()
	try {
		await callback(harness)
	}
	finally {
		await rm(harness.root, { recursive: true, force: true })
	}
}

/**
 * 固定 Steam 根路径的探测回调。
 * @param {string | undefined} steamPath Steam 根
 * @returns {() => Promise<string | undefined>} 回调
 */
function windowsSteamAt(steamPath) {
	/**
	 * @returns {Promise<string | undefined>} Steam 根
	 */
	return function windowsSteamPath() {
		return Promise.resolve(steamPath)
	}
}

/**
 * 固定用户库列表的探测回调。
 * @param {object[]} users 用户库
 * @returns {() => Promise<object[]>} 回调
 */
function librariesOf(users) {
	/**
	 * @returns {Promise<object[]>} 用户库
	 */
	return function findLibraries() {
		return Promise.resolve(users)
	}
}

Deno.test('cropSvgToAspect centers a square viewBox onto Steam hero aspect', () => {
	const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000"><rect/></svg>'
	const out = cropSvgToAspect(svg, 1920, 620)
	assertStringIncludes(out, 'width="1920"')
	assertStringIncludes(out, 'height="620"')
	const viewBox = /viewBox="([^"]+)"/.exec(out)[1].split(' ').map(Number)
	assertEquals(viewBox[0], 0)
	assert(Math.abs(viewBox[1] - 338.541666) < 0.01)
	assertEquals(viewBox[2], 1000)
	assert(Math.abs(viewBox[3] - 322.916666) < 0.01)
})

Deno.test('quoteSteamPath / unquoteSteamPath round-trip', () => {
	assertEquals(unquoteSteamPath('"C:\\fount\\"'), 'C:\\fount\\')
	assertEquals(unquoteSteamPath('/home/u/fount/'), '/home/u/fount/')
	assertStringIncludes(quoteSteamPath('/opt/fount'), '"')
})

Deno.test('steamShortcutAppId is crc32 with the high bit set', () => {
	const exe = '"C:\\fount\\fount.exe"'
	const appId = steamShortcutAppId(exe, 'fount')
	assertEquals(appId, steamShortcutAppId(exe, 'fount'))
	assert((appId & 0x80000000) !== 0)
	assert(appId !== steamShortcutAppId(exe, 'other'))
})

Deno.test('binary vdf roundtrip keeps sibling shortcuts', () => {
	const root = {
		shortcuts: {
			0: { appid: 1, AppName: 'Other', Exe: '"x"', StartDir: '"y"', tags: {} },
			1: { appid: 2, AppName: 'fount', Exe: '"f"', StartDir: '"d"', tags: {} },
		},
	}
	const back = parseBinaryVdf(writeBinaryVdf(root))
	assertEquals(back.shortcuts[0].AppName, 'Other')
	assertEquals(back.shortcuts[1].AppName, 'fount')
	assertEquals(back.shortcuts[1].appid, 2)
})

Deno.test('parseBinaryVdf rejects truncated vdf', () => {
	const full = writeBinaryVdf({ shortcuts: { 0: { AppName: 'x', appid: 1 } } })
	assertThrows(() => parseBinaryVdf(full.subarray(0, -1)))
	assertThrows(() => parseBinaryVdf(Uint8Array.of(1, 97, 0, 98)))
	assertThrows(() => parseBinaryVdf(Uint8Array.of(2, 97, 0, 1, 2)))
})

Deno.test('entryToSteam maps present fields and omits the rest', () => {
	assertEquals(entryToSteam({ appName: 'fount', isHidden: true, allowOverlay: false, appId: -1 }), {
		AppName: 'fount',
		IsHidden: 1,
		AllowOverlay: 0,
		appid: 4294967295,
	})
	assertEquals(entryToSteam({ tags: ['a'] }).tags, { 0: 'a' })
	assertEquals(entryToSteam({}), {})
	assertThrows(() => entryToSteam({ tags: undefined }))
})

Deno.test('ShortcutsFile rejects a root without a shortcuts object', () => {
	assertThrows(() => new ShortcutsFile({}))
	assertThrows(() => new ShortcutsFile({ shortcuts: null }))
	assertEquals(new ShortcutsFile().entries, [])
	const shortcuts = new ShortcutsFile({
		shortcuts: { 0: { appid: 1, AppName: 'x', Exe: '"x"', StartDir: '"y"' } },
	})
	assertEquals(shortcuts.entries[0].appName, 'x')
	assertEquals(parseBinaryVdf(shortcuts.toBuffer()).shortcuts[0].AppName, 'x')
	assertThrows(() => writeBinaryVdf({ shortcuts: { 0: { AppName: null } } }))
})

Deno.test('steamLaunchPaths uses fount.exe on Windows and path/fount elsewhere', () => {
	const win = steamLaunchPaths('C:/fount', 'win32')
	assert(unquoteSteamPath(win.exe).replaceAll('\\', '/').endsWith('fount.exe'))
	const unix = steamLaunchPaths('/opt/fount', 'linux')
	assert(unquoteSteamPath(unix.exe).replaceAll('\\', '/').endsWith('path/fount'))
})

Deno.test('isFountEntry matches launcher path or name+startDir', () => {
	const dir = REPO_ROOT
	assert(isFountEntry({
		appName: 'fount',
		exe: quoteSteamPath(join(dir, 'fount.exe')),
		startDir: quoteSteamPath(dir),
	}, dir))
	assert(isFountEntry({
		appName: 'other',
		exe: quoteSteamPath(join(dir, 'path', 'fount')),
		startDir: quoteSteamPath('/tmp'),
	}, dir))
	assertEquals(isFountEntry({
		appName: 'fount',
		exe: quoteSteamPath('/games/other.exe'),
		startDir: quoteSteamPath('/games'),
	}, dir), false)
})

Deno.test('applyFountSteamEntry adds then updates and drops extras', () => withSteamHarness(async ({ fountDir, user }) => {
	const launch = steamLaunchPaths(fountDir, 'linux')
	const shortcuts = await loadShortcutsFile(user.shortcuts)
	const added = applyFountSteamEntry(shortcuts, { fountDir, exe: launch.exe, startDir: launch.startDir })
	assertEquals(added.action, 'added')
	assertEquals(shortcuts.entries.length, 1)
	shortcuts.addEntry({
		appName: 'fount',
		exe: launch.exe,
		startDir: launch.startDir,
	})
	assertEquals(shortcuts.entries.length, 2)
	const updated = applyFountSteamEntry(shortcuts, { fountDir, exe: launch.exe, startDir: launch.startDir })
	assertEquals(updated.action, 'updated')
	assertEquals(shortcuts.entries.length, 1)
	assertEquals(shortcuts.entries[0].appName, 'fount')
	assertEquals(shortcuts.entries[0].appId, steamShortcutAppId(launch.exe, 'fount'))
}))

Deno.test('ensureSteamImages writes pngs and skips when fresh', () => withSteamHarness(async ({ fountDir }) => {
	const imgs = join(fountDir, 'imgs')
	const first = await ensureSteamImages(imgs)
	assert(first.hero.replaceAll('\\', '/').endsWith('steam/hero.png'))
	assert(first.logo.replaceAll('\\', '/').endsWith('steam/logo.png'))
	assert(first.icon.replaceAll('\\', '/').endsWith('steam/icon.png'))
	assert(first.portrait.replaceAll('\\', '/').endsWith('steam/portrait.png'))
	assert(first.landscape.replaceAll('\\', '/').endsWith('steam/landscape.png'))
	for (const path of Object.values(first))
		assert(existsSync(path), path)
	const heroStat = await stat(first.hero)
	await ensureSteamImages(imgs)
	assertEquals((await stat(first.hero)).mtimeMs, heroStat.mtimeMs)
}))

Deno.test('FOUNT_STEAM status line is one JSON object', () => {
	const logs = []
	const orig = console.log
	/**
	 * 捕获状态行。
	 * @param {string} value 打印值
	 * @returns {void}
	 */
	function captureLog(value) {
		logs.push(value)
	}
	console.log = captureLog
	try {
		emitSteamStatus({ status: 'ok', action: 'added', appIds: [1] })
	}
	finally {
		console.log = orig
	}
	assertEquals(logs.length, 1)
	assert(logs[0].startsWith('FOUNT_STEAM:'))
	assertEquals(JSON.parse(logs[0].slice('FOUNT_STEAM:'.length)), {
		status: 'ok',
		action: 'added',
		appIds: [1],
	})
})

Deno.test('probeSteam skips when no install paths exist', async () => {
	const result = await probeSteam({
		platform: 'linux',
		home: join(tmpdir(), 'fount-no-steam-home-missing'),
	})
	assertEquals(result.status, 'skip')
})

Deno.test('findSteamInstallPaths uses the Windows registry callback', () => withSteamHarness(async ({ root }) => {
	const steamPath = join(root, 'steam')
	const found = await findSteamInstallPaths({
		platform: 'win32',
		windowsSteamPath: windowsSteamAt(steamPath),
	})
	assertEquals(found, [steamPath])
	assertEquals(await findSteamInstallPaths({
		platform: 'win32',
		windowsSteamPath: windowsSteamAt(join(root, 'missing-steam')),
	}), [])
}))

Deno.test('registerFountSteam skips when no libraries', async () => {
	const result = await registerFountSteam({
		fountDir: REPO_ROOT,
		findLibraries: librariesOf([]),
	})
	assertEquals(result.status, 'skip')
})

Deno.test('registerFountSteam reports need_exe on Windows when fount.exe is missing', () => withSteamHarness(async ({ fountDir, user }) => {
	const result = await registerFountSteam({
		fountDir,
		platform: 'win32',
		findLibraries: librariesOf([user]),
	})
	assertEquals(result.status, 'need_exe')
	assert(result.exePath.endsWith('fount.exe'))
}))

Deno.test('register then unregister writes and clears shortcuts.vdf plus grid images', () => withSteamHarness(async ({ root, fountDir, user }) => {
	const findLibraries = librariesOf([user])
	const registered = await registerFountSteam({
		fountDir,
		platform: 'linux',
		findLibraries,
	})
	assertEquals(registered.status, 'ok')
	assertEquals(registered.action, 'added')
	const shortcuts = await loadShortcutsFile(user.shortcuts)
	assertEquals(shortcuts.entries.length, 1)
	assertEquals(shortcuts.entries[0].appName, 'fount')
	const { appId } = shortcuts.entries[0]
	assertEquals(appId, steamShortcutAppId(steamLaunchPaths(fountDir, 'linux').exe, 'fount'))
	assert(existsSync(join(user.grid, `${appId}p.png`)))
	assert(existsSync(join(user.grid, `${appId}_hero.png`)))
	assert(existsSync(join(user.grid, `${appId}_logo.png`)))
	assert(existsSync(join(user.grid, `${appId}_icon.png`)))
	const png = await readFile(join(user.grid, `${appId}_hero.png`))
	assertEquals(png[0], 0x89)
	assertEquals(png[1], 0x50)

	const otherDir = join(root, 'other-fount')
	const skipped = await unregisterFountSteam({ fountDir: otherDir, findLibraries })
	assertEquals(skipped.status, 'ok')
	assertEquals(skipped.action, 'absent')
	assertEquals((await loadShortcutsFile(user.shortcuts)).entries.length, 1)

	const removed = await unregisterFountSteam({ fountDir, findLibraries })
	assertEquals(removed.status, 'ok')
	assertEquals(removed.action, 'removed')
	const after = await loadShortcutsFile(user.shortcuts)
	assertEquals(after.entries.length, 0)
	assertEquals(existsSync(join(user.grid, `${appId}_hero.png`)), false)
}))

Deno.test('copySteamImages replaces previous hero/logo/icon files', () => withSteamHarness(async ({ fountDir, user }) => {
	const images = await ensureSteamImages(join(fountDir, 'imgs'))
	await mkdir(user.grid, { recursive: true })
	await writeFile(join(user.grid, '42_hero.jpg'), 'old')
	await copySteamImages(user.grid, 42, images)
	assertEquals(existsSync(join(user.grid, '42_hero.jpg')), false)
	assert(existsSync(join(user.grid, '42_hero.png')))
	assert(existsSync(join(user.grid, '42p.png')))
}))
