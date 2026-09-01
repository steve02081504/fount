/** 空闲更新直接按路径调用独立的运行时更新脚本；版本变化才重启。 */
/* global Deno */
import assert from 'node:assert/strict'
import { join } from 'node:path'

import { autoUpdateEnabled, disableAutoUpdate, enableAutoUpdate } from '../../autoupdate.mjs'

import { idleHandlers, updateFixture } from './fixtures/autoupdate.mjs'

const executablePath = '/opt/User Deno/bin/deno'
const updateDenoScript = join('/autoupdate-fixture', 'path/src', 'update-deno.sh')
const updateDenoScriptWin = join('/autoupdate-fixture', 'path/src', 'update-deno.ps1')

/**
 * 通过真实模块的空闲回调运行更新，外部调用由限定导入范围的夹具接管。
 * @param {object} [options] 系统、所有权与版本夹具。
 * @param {string} [options.os] 运行时报告的操作系统。
 * @param {boolean} [options.termux] 是否存在 Termux 标志目录。
 * @param {string} [options.version] 运行中的 Deno 版本。
 * @param {string} [options.nextVersion] 升级后查询到的 Deno 版本。
 * @param {boolean} [options.updateFails] 是否模拟更新脚本失败。
 * @param {string} [options.execPath] 运行时报告的可执行文件路径。
 * @param {string} [options.resolvedPath] 跟随符号链接后得到的真实路径。
 * @param {string|null} [options.realpathError] 路径解析抛出的错误代码。
 * @returns {Promise<{calls: Array, restarts: number, realpaths: string[]}>} 外部调用、重启计数和解析路径。
 */
async function checkUpdate({ os = 'linux', termux = false, version = '2.9.6', nextVersion = version, updateFails = false, execPath = executablePath, resolvedPath = '/opt/User Deno/bin/deno/resolved', realpathError = null } = {}) {
	const originalBuild = Deno.build
	const originalVersion = Deno.version
	const originalExecPath = Deno.execPath
	Object.assign(updateFixture, { termux, nextVersion, updateFails, resolvedPath, realpathError, calls: [], restarts: 0, realpaths: [], warnings: [] })
	try {
		Deno.build = { ...originalBuild, os }
		Deno.version = { ...originalVersion, deno: version }
		/**
		 * 返回本用例指定的运行时路径。
		 * @returns {string} 运行中的可执行文件路径。
		 */
		Deno.execPath = () => {
			assert.equal(os, 'linux', 'non-Linux updates must not resolve the running executable')
			assert.equal(termux, false, 'Termux updates must not resolve the running executable')
			return execPath
		}
		enableAutoUpdate()
		assert.equal(autoUpdateEnabled, true)
		assert.equal(idleHandlers.size, 2)
		for (const handler of idleHandlers) await handler()
		return { calls: updateFixture.calls, restarts: updateFixture.restarts, realpaths: updateFixture.realpaths }
	}
	finally {
		disableAutoUpdate()
		Deno.build = originalBuild
		Deno.version = originalVersion
		Deno.execPath = originalExecPath
		assert.equal(autoUpdateEnabled, false)
		assert.equal(idleHandlers.size, 0)
	}
}

Deno.test('idle update invokes the standalone update-deno script on Linux', async () => {
	assert.deepEqual(await checkUpdate(), {
		calls: [
			['bash', [updateDenoScript]],
			['/opt/User Deno/bin/deno/resolved', ['-V']],
		],
		restarts: 0,
		realpaths: [executablePath],
	})
})

Deno.test('idle update restarts only after the running executable changes version', async () => {
	assert.equal((await checkUpdate({ nextVersion: '2.9.7' })).restarts, 1)
})

Deno.test('idle update keeps the running-executable resolution for the version check', async () => {
	assert.deepEqual(await checkUpdate({ resolvedPath: '/usr/lib/deno/deno' }), {
		calls: [
			['bash', [updateDenoScript]],
			['/usr/lib/deno/deno', ['-V']],
		],
		restarts: 0,
		realpaths: [executablePath],
	})
})

Deno.test('a failing update script still performs the version check without crashing', async () => {
	assert.deepEqual(await checkUpdate({ updateFails: true, nextVersion: '2.9.7' }), {
		calls: [
			['bash', [updateDenoScript]],
			['/opt/User Deno/bin/deno/resolved', ['-V']],
		],
		restarts: 1,
		realpaths: [executablePath],
	})
})

Deno.test('idle update skips a deleted Linux executable without PATH fallback', async () => {
	assert.deepEqual(await checkUpdate({ execPath: '/usr/bin/deno (deleted)', resolvedPath: '/usr/bin/deno' }), {
		calls: [],
		restarts: 0,
		realpaths: ['/usr/bin/deno (deleted)'],
	})
	assert.deepEqual(updateFixture.warnings, ['Deno executable no longer exists; restart fount before checking runtime updates.'])
})

Deno.test('unexpected Linux executable resolution failures remain visible', async () => {
	await assert.rejects(checkUpdate({ realpathError: 'EACCES' }), { code: 'EACCES' })
	assert.deepEqual(updateFixture.calls, [])
	assert.deepEqual(updateFixture.warnings, [])
})

Deno.test('idle update on macOS and Termux delegates to the POSIX script without runtime resolution', async () => {
	for (const [name, os, termux] of [['darwin', 'darwin', false], ['Termux', 'linux', true]]) 
		assert.deepEqual(await checkUpdate({ os, termux }), {
			calls: [
				['bash', [updateDenoScript]],
				'deno -V',
			],
			restarts: 0,
			realpaths: [],
		})
	
})

Deno.test('idle update on Windows delegates through powershell_exec to the PS script and checks PATH deno', async () => {
	assert.deepEqual(await checkUpdate({ os: 'windows' }), {
		calls: [
			['powershell_exec', `& '${updateDenoScriptWin}'`],
			'deno -V',
		],
		restarts: 0,
		realpaths: [],
	})
})

Deno.test('idle update on Windows restarts when the PATH deno version changes', async () => {
	assert.equal((await checkUpdate({ os: 'windows', nextVersion: '2.9.7' })).restarts, 1)
})
