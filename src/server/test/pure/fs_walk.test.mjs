/**
 * 目录遍历辅助：跟随符号链接/junction 解析真实类型，容忍断链。
 */
/* global Deno */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { assert, assertEquals } from 'jsr:@std/assert'

import { canonicalPath, readDirEntries } from '../../../scripts/fs_walk.mjs'

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

Deno.test('readDirEntries follows symlinked/junction directories', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'fount_fs_walk_'))
	try {
		const real = path.join(root, 'real-part')
		await mkdir(real, { recursive: true })
		await writeFile(path.join(real, 'fount.json'), '{}')
		const alias = path.join(root, 'alias-part')
		await makeLink(real, alias, true)

		const entries = readDirEntries(root)
		const entry = entries.find(item => item.name === 'alias-part')
		assert(entry)
		assertEquals(entry.isDirectory, true)
		assertEquals(entry.isFile, false)
		assertEquals(canonicalPath(alias), canonicalPath(real))
	}
	finally {
		await rm(root, { recursive: true, force: true })
	}
})

Deno.test('readDirEntries tolerates broken symlinks and missing directories', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'fount_fs_walk_'))
	try {
		const real = path.join(root, 'gone')
		await mkdir(real, { recursive: true })
		const broken = path.join(root, 'broken')
		await makeLink(real, broken, true)
		await rm(real, { recursive: true, force: true })

		const entry = readDirEntries(root).find(item => item.name === 'broken')
		assert(entry)
		assertEquals(entry.isDirectory, false)
		assertEquals(entry.isFile, false)
		assertEquals(canonicalPath(broken), null)
		assertEquals(readDirEntries(path.join(root, 'missing')), [])
	}
	finally {
		await rm(root, { recursive: true, force: true })
	}
})
