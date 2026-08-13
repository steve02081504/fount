/**
 * 用户目录嵌套 git 根：找到独立 .git，不借用 fount HEAD。
 */
/* global Deno */
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals } from 'jsr:@std/assert'

import { findNestedGitRoot } from '../kernel/nested_git.mjs'

Deno.test('findNestedGitRoot walks up to nested .git inside data/users', async () => {
	const root = join(tmpdir(), `fount-nested-git-${Date.now()}`)
	const part = join(root, 'data', 'users', 'u', 'chars', 'c')
	await mkdir(join(part, '.git'), { recursive: true })
	await mkdir(join(part, 'test'), { recursive: true })
	const manifest = join(part, 'test', 'manifest.json')
	await writeFile(manifest, '{}')
	try {
		assertEquals(
			await findNestedGitRoot(manifest, root),
			'data/users/u/chars/c',
		)
	}
	finally {
		await rm(root, { recursive: true, force: true })
	}
})

Deno.test('findNestedGitRoot returns null without nested git', async () => {
	const root = join(tmpdir(), `fount-nested-git-none-${Date.now()}`)
	const testDir = join(root, 'data', 'users', 'u', 'chars', 'c', 'test')
	await mkdir(testDir, { recursive: true })
	const manifest = join(testDir, 'manifest.json')
	await writeFile(manifest, '{}')
	await mkdir(join(root, '.git'), { recursive: true })
	try {
		assertEquals(await findNestedGitRoot(manifest, root), null)
	}
	finally {
		await rm(root, { recursive: true, force: true })
	}
})
