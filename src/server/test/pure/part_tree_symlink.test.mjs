/**
 * part 树扫描：symlink/junction 挂载的部件目录也要被发现（issue #334）。
 */
/* global Deno */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { assert, assertEquals } from 'jsr:@std/assert'

import { walkFountJsonFiles } from '../../parts_loader.mjs'

const isWin = process.platform === 'win32'

/**
 * 创建目录/文件符号链接（Windows 目录用免提权的 junction）。
 * @param {string} target - 链接目标。
 * @param {string} linkPath - 链接路径。
 * @param {boolean} isDir - 目标是否为目录。
 * @returns {Promise<void>}
 */
const makeLink = async (target, linkPath, isDir) => {
	if (isWin) await symlink(target, linkPath, isDir ? 'junction' : 'file')
	else await symlink(target, linkPath, isDir ? 'dir' : 'file')
}

Deno.test('walkFountJsonFiles enters symlinked/junction part directories', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'fount_part_scan_'))
	try {
		const realPart = path.join(root, 'real', 'GentianAphrodite')
		await mkdir(realPart, { recursive: true })
		await writeFile(path.join(realPart, 'fount.json'), JSON.stringify({ type: 'chars', dirname: 'GentianAphrodite' }))

		const mount = path.join(root, 'mount')
		await mkdir(path.join(mount, 'chars'), { recursive: true })
		await makeLink(realPart, path.join(mount, 'chars', 'GentianAphrodite'), true)

		const files = walkFountJsonFiles(mount)
		assertEquals(
			files.map(file => path.relative(mount, file).replace(/\\/g, '/')),
			['chars/GentianAphrodite/fount.json'],
		)
	}
	finally {
		await rm(root, { recursive: true, force: true })
	}
})

Deno.test('walkFountJsonFiles collects symlinked fount.json files', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'fount_part_scan_'))
	try {
		const holder = path.join(root, 'holder')
		await mkdir(holder, { recursive: true })
		const realJson = path.join(root, 'shared-fount.json')
		await writeFile(realJson, '{}')
		try {
			await makeLink(realJson, path.join(holder, 'fount.json'), false)
		}
		catch (error) {
			if (error.code === 'EPERM' || error.code === 'UNKNOWN' || error.code === 'ENOTSUP') return
			throw error
		}

		const files = walkFountJsonFiles(root)
		assert(files.includes(path.join(holder, 'fount.json')))
	}
	finally {
		await rm(root, { recursive: true, force: true })
	}
})

Deno.test('walkFountJsonFiles terminates on symlink cycles and dedupes', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'fount_part_scan_'))
	try {
		const part = path.join(root, 'part')
		await mkdir(part, { recursive: true })
		await writeFile(path.join(part, 'fount.json'), '{}')
		await makeLink(part, path.join(part, 'loop'), true)

		assertEquals(walkFountJsonFiles(part), [path.join(part, 'fount.json')])
	}
	finally {
		await rm(root, { recursive: true, force: true })
	}
})

Deno.test('walkFountJsonFiles tolerates broken links', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'fount_part_scan_'))
	try {
		const realPart = path.join(root, 'real-part')
		await mkdir(realPart, { recursive: true })
		await writeFile(path.join(realPart, 'fount.json'), '{}')

		const gone = path.join(root, 'gone')
		await mkdir(gone, { recursive: true })
		const dangling = path.join(root, 'dangling')
		await makeLink(gone, dangling, true)
		await rm(gone, { recursive: true, force: true })

		assertEquals(walkFountJsonFiles(root), [path.join(realPart, 'fount.json')])
	}
	finally {
		await rm(root, { recursive: true, force: true })
	}
})
