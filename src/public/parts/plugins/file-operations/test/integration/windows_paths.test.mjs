/* global Deno */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { assertEquals, assertThrows } from 'jsr:@std/assert'

import { findWindowsBash, mapWindowsPath, resolveNativePath } from '../../src/windows_paths.mjs'

Deno.test('Windows bash selection follows actual PATH hits, including quoted directories', () => {
	assertEquals(findWindowsBash('C:\\missing;"C:\\Program Files\\Git\\bin";C:\\msys64\\usr\\bin', file => file.includes('Git')), 'C:\\Program Files\\Git\\bin\\bash.exe')
	assertEquals(findWindowsBash('C:\\missing', () => false), null)
})

Deno.test('Windows POSIX paths use Git, MSYS and Cygwin installation roots', () => {
	assertEquals(mapWindowsPath('/home/alice/a.txt', { bash: 'C:\\Program Files\\Git\\bin\\bash.exe' }), 'C:\\Program Files\\Git\\home\\alice\\a.txt')
	assertEquals(mapWindowsPath('/usr/bin/tool', { bash: 'D:\\msys64\\usr\\bin\\bash.exe' }), 'D:\\msys64\\usr\\bin\\tool')
	assertEquals(mapWindowsPath('/home/alice', { bash: 'D:\\cygwin64\\bin\\bash.exe' }), 'D:\\cygwin64\\home\\alice')
	for (const value of ['/c/Users/alice/a.txt', '/cygdrive/c/Users/alice/a.txt', '/mnt/c/Users/alice/a.txt'])
		assertEquals(mapWindowsPath(value), 'C:\\Users\\alice\\a.txt')
	assertThrows(() => mapWindowsPath('/home/alice'), Error, 'no known Windows bash root')
	assertEquals(mapWindowsPath('/home/alice', { bash: 'D:\\msys64\\usr\\bin\\bash.exe', root: 'C:\\other' }), 'D:\\msys64\\home\\alice')
})

Deno.test('target-local resolver reads the actual PATH installation without starting bash', async () => {
	if (process.platform !== 'win32') return
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fount_bash_paths_'))
	const previousPath = process.env.PATH
	const previousDistro = process.env.WSL_DISTRO_NAME
	try {
		const bin = path.join(root, 'usr', 'bin')
		await fs.mkdir(bin, { recursive: true })
		await fs.writeFile(path.join(bin, 'bash.exe'), 'not an executable')
		process.env.PATH = `${bin};${previousPath}`
		delete process.env.WSL_DISTRO_NAME
		assertEquals(await resolveNativePath('/home/alice/a.txt'), path.join(root, 'home', 'alice', 'a.txt'))
		assertEquals(await resolveNativePath('b.txt', '/home/alice'), path.join(root, 'home', 'alice', 'b.txt'))
		assertEquals(await resolveNativePath('/home/alice', '\\\\wsl.localhost\\Debian\\work'), '\\\\wsl.localhost\\Debian\\home\\alice')
	}
	finally {
		if (previousPath === undefined) delete process.env.PATH
		else process.env.PATH = previousPath
		if (previousDistro === undefined) delete process.env.WSL_DISTRO_NAME
		else process.env.WSL_DISTRO_NAME = previousDistro
		await fs.rm(root, { recursive: true, force: true })
	}
})

Deno.test('WSL paths retain their selected distribution, native paths stay native', () => {
	assertEquals(mapWindowsPath('/home/alice/a.txt', { bash: 'C:\\Windows\\System32\\bash.exe', distro: 'Ubuntu' }), '\\\\wsl.localhost\\Ubuntu\\home\\alice\\a.txt')
	assertThrows(() => mapWindowsPath('/home/alice', { bash: 'C:\\Windows\\System32\\bash.exe' }), Error, 'WSL distribution is unknown')
	assertEquals(mapWindowsPath('\\\\wsl.localhost\\Debian\\home\\bob', { distro: 'Ubuntu' }), '\\\\wsl.localhost\\Debian\\home\\bob')
	assertEquals(mapWindowsPath('C:/Users/alice'), 'C:\\Users\\alice')
})
