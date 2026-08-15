/**
 * Pages 本地服务器：目录路由 Content-Type、hooked 缓存隔离。
 */
/* global Deno */
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert'

import { REPO_ROOT } from '../core/repo_root.mjs'
import { createPagesApp } from '../playwright/pages_server.mjs'

/**
 * @param {string} marker 写入 HTML 的可辨识文本
 * @returns {Promise<string>} 临时仓库根
 */
async function makePagesRoot(marker) {
	const root = await mkdtemp(join(tmpdir(), 'pages-server-'))
	const dir = join(root, '.github', 'pages', 'EULA')
	await mkdir(dir, { recursive: true })
	await writeFile(
		join(dir, 'index.html'),
		`<!DOCTYPE html><html><body>${marker} __FOUNT_GIT_REF__</body></html>\n`,
		'utf8',
	)
	return root
}

/**
 * @param {import('npm:express').Express} app Express
 * @returns {Promise<{ port: number, close: () => Promise<void> }>} 句柄
 */
function listenApp(app) {
	return new Promise((resolve, reject) => {
		const server = app.listen(0, '127.0.0.1', () => {
			const address = server.address()
			resolve({
				port: address.port,
				/**
				 * 关闭测试 HTTP server。
				 * @returns {Promise<void>}
				 */
				close: () => new Promise((closeResolve, closeReject) => {
					server.closeAllConnections?.()
					server.close(error => error ? closeReject(error) : closeResolve())
				}),
			})
		})
		server.on('error', reject)
	})
}

Deno.test('directory route hooked HTML uses html Content-Type', async () => {
	const root = await makePagesRoot('eula-page')
	const app = createPagesApp(root)
	const { port, close } = await listenApp(app)
	try {
		const response = await fetch(`http://127.0.0.1:${port}/fount/EULA/`)
		assertEquals(response.ok, true)
		assertStringIncludes(response.headers.get('content-type') || '', 'text/html')
		assertStringIncludes(await response.text(), 'eula-page')
	}
	finally {
		await close()
		await rm(root, { recursive: true, force: true })
	}
})

Deno.test('hooked file cache is per createPagesApp instance', async () => {
	const rootA = await makePagesRoot('site-a')
	const rootB = await makePagesRoot('site-b')
	const siteA = await listenApp(createPagesApp(rootA))
	const siteB = await listenApp(createPagesApp(rootB))
	try {
		const textA = await (await fetch(`http://127.0.0.1:${siteA.port}/fount/EULA/`)).text()
		const textB = await (await fetch(`http://127.0.0.1:${siteB.port}/fount/EULA/`)).text()
		assertStringIncludes(textA, 'site-a')
		assertStringIncludes(textB, 'site-b')
	}
	finally {
		await siteA.close()
		await siteB.close()
		await rm(rootA, { recursive: true, force: true })
		await rm(rootB, { recursive: true, force: true })
	}
})

Deno.test('hooked pages reject Windows-style path escape', async () => {
	const root = await makePagesRoot('public-eula')
	const leaked = join(root, '.github', 'pages-private')
	await mkdir(leaked, { recursive: true })
	await writeFile(
		join(leaked, 'secret.html'),
		'<!DOCTYPE html><html><body>LEAKED-PRIVATE __FOUNT_GIT_REF__</body></html>\n',
		'utf8',
	)
	const { port, close } = await listenApp(createPagesApp(root))
	try {
		const text = await (await fetch(`http://127.0.0.1:${port}/fount/x%5C..%5C..%5Cpages-private/secret.html`)).text()
		assert(!text.includes('LEAKED-PRIVATE'), text)
	}
	finally {
		await close()
		await rm(root, { recursive: true, force: true })
	}
})

Deno.test('hooked pages reject malformed percent-encoding with 400', async () => {
	const root = await makePagesRoot('public-eula')
	const { port, close } = await listenApp(createPagesApp(root))
	try {
		const malformed = await fetch(`http://127.0.0.1:${port}/fount/%zz`)
		assertEquals(malformed.status, 400)
		const invalidUtf8 = await fetch(`http://127.0.0.1:${port}/fount/%80`)
		assertEquals(invalidUtf8.status, 400)
	}
	finally {
		await close()
		await rm(root, { recursive: true, force: true })
	}
})

Deno.test('pages scripts overlay serves GitHub Pages registries stub', async () => {
	const { port, close } = await listenApp(createPagesApp(REPO_ROOT))
	try {
		const response = await fetch(`http://127.0.0.1:${port}/fount/scripts/endpoints/registries.mjs`)
		assertEquals(response.ok, true)
		const text = await response.text()
		assert(!text.includes('/api/registries'), text)
		assertStringIncludes(text, 'GitHub Pages')
	}
	finally {
		await close()
	}
})
