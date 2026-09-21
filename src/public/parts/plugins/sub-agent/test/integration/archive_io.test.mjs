/* global Deno */
/**
 * sub-agent 父代档案 I/O 集成测试：写入/读取/删除与 TTL 清理。
 */
import fs from 'node:fs'
import path from 'node:path'

import { assertEquals, assert } from 'jsr:@std/assert'

import {
	archiveDirectory,
	cleanupExpiredArchives,
	removeParentArchive,
	writeParentArchive,
} from '../../archive.mjs'

/**
 * 清理测试创建的文件与（空）目录，避免临时目录残留。
 * @param {string[]} filePaths 待删除文件
 * @returns {void}
 */
function cleanup(filePaths) {
	for (const filePath of filePaths) removeParentArchive(filePath)
	try {
		fs.rmdirSync(archiveDirectory())
	}
	catch { /* 目录非空或不存在则保留 */ }
}

Deno.test('writeParentArchive writes a readable JSON projection and remove deletes it', () => {
	const directory = archiveDirectory()
	const filePath = writeParentArchive('test-run-io', [{ role: 'user', name: 'U', uid: 'u', time_stamp: 1, content: 'hi' }])
	try {
		assertEquals(path.dirname(filePath), directory)
		const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
		assertEquals(parsed.runId, 'test-run-io')
		assertEquals(parsed.entries.length, 1)
		assertEquals(parsed.entries[0].content, 'hi')
	}
	finally {
		cleanup([filePath])
	}
	assertEquals(fs.existsSync(filePath), false)
})

Deno.test('cleanupExpiredArchives removes only archives older than the TTL', () => {
	const now = Date.now()
	const oldFile = writeParentArchive('test-run-old', [])
	const freshFile = writeParentArchive('test-run-fresh', [])
	try {
		fs.utimesSync(oldFile, new Date(now - 10_000), new Date(now - 10_000))
		const removed = cleanupExpiredArchives(5_000, now)
		assert(removed >= 1, `expected at least one removal, got ${removed}`)
		assertEquals(fs.existsSync(oldFile), false)
		assertEquals(fs.existsSync(freshFile), true)
	}
	finally {
		cleanup([oldFile, freshFile])
	}
})
