/** Linux 空闲更新须尊重 pacman 所有权，其他平台保持既有更新命令。 */
/* global Deno */
import assert from 'node:assert/strict'

import { autoUpdateEnabled, disableAutoUpdate, enableAutoUpdate } from '../../autoupdate.mjs'

import { idleHandlers, updateFixture } from './fixtures/autoupdate.mjs'

const executablePath = '/opt/User Deno/bin/deno'

/**
 * 通过真实模块的空闲回调运行更新，外部调用由限定导入范围的夹具接管。
 * @param {object} [options] 系统、所有权与版本夹具。
 * @param {string} [options.os] 运行时报告的操作系统。
 * @param {boolean} [options.termux] 是否存在 Termux 标志目录。
 * @param {boolean} [options.managed] 当前可执行文件是否由 pacman 管理。
 * @param {string} [options.version] 运行中的 Deno 版本。
 * @param {string} [options.nextVersion] 升级后查询到的 Deno 版本。
 * @param {boolean} [options.missingPacman] 是否模拟 pacman 不存在。
 * @param {boolean} [options.upgradeFails] 是否模拟升级命令失败。
 * @param {string} [options.execPath] 运行时报告的可执行文件路径。
 * @param {string} [options.resolvedPath] 跟随符号链接后得到的真实路径。
 * @param {string|null} [options.realpathError] 路径解析抛出的错误代码。
 * @returns {Promise<{calls: Array, restarts: number, realpaths: string[]}>} 外部调用、重启计数和解析路径。
 */
async function checkUpdate({ os = 'linux', termux = false, managed = false, version = '2.9.6', nextVersion = version, missingPacman = false, upgradeFails = false, execPath = executablePath, resolvedPath = '/opt/User Deno/bin/deno/resolved', realpathError = null } = {}) {
	const originalBuild = Deno.build
	const originalVersion = Deno.version
	const originalExecPath = Deno.execPath
	Object.assign(updateFixture, { managed, termux, nextVersion, missingPacman, upgradeFails, resolvedPath, realpathError, calls: [], restarts: 0, realpaths: [], warnings: [] })
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

Deno.test('idle update never overwrites pacman-owned Deno', async () => {
	assert.deepEqual(await checkUpdate({ managed: true }), {
		calls: [['pacman', ['-Qqo', '--', '/opt/User Deno/bin/deno/resolved']]],
		restarts: 0,
		realpaths: [executablePath],
	})
})

for (const [version, channel] of [['2.9.6', 'stable'], ['2.10.0+canary', 'canary'], ['2.10.0-rc.1', 'rc']])
	Deno.test(`idle update preserves ${channel} updates for user-managed Deno`, async () => {
		assert.deepEqual(await checkUpdate({ version }), {
			calls: [
				['pacman', ['-Qqo', '--', '/opt/User Deno/bin/deno/resolved']],
				['/opt/User Deno/bin/deno/resolved', ['upgrade', '-q', channel]],
				['/opt/User Deno/bin/deno/resolved', ['-V']],
			],
			restarts: 0,
			realpaths: [executablePath],
		})
	})
Deno.test('idle update restarts only after the running executable changes version', async () => {
	assert.equal((await checkUpdate({ nextVersion: '2.9.7' })).restarts, 1)
})

Deno.test('missing pacman does not disable user-managed runtime updates', async () => {
	assert.equal((await checkUpdate({ missingPacman: true })).calls.length, 3)
})

Deno.test('idle update checks the resolved running system executable rather than another Deno on PATH', async () => {
	assert.deepEqual(await checkUpdate({ managed: true, resolvedPath: '/usr/lib/deno/deno' }), {
		calls: [['pacman', ['-Qqo', '--', '/usr/lib/deno/deno']]],
		restarts: 0,
		realpaths: [executablePath],
	})
})

for (const managed of [true, false])
	Deno.test(`idle update skips a deleted Linux executable without PATH fallback (pacman managed: ${managed})`, async () => {
		assert.deepEqual(await checkUpdate({ managed, execPath: '/usr/bin/deno (deleted)', resolvedPath: '/usr/bin/deno' }), {
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

for (const [name, os, termux] of [['windows', 'windows', false], ['darwin', 'darwin', false], ['Termux', 'linux', true]]) {
	for (const [version, channel] of [['2.9.6', 'stable'], ['2.10.0+canary', 'canary'], ['2.10.0-rc.1', 'rc']])
		Deno.test(`idle update on ${name} preserves the PATH-based ${channel} commands`, async () => {
			assert.deepEqual(await checkUpdate({ os, termux, version }), {
				calls: [`deno upgrade -q ${channel}`, 'deno -V'],
				restarts: 0,
				realpaths: [],
			})
		})
	Deno.test(`idle update on ${name} preserves version checks after a failed upgrade`, async () => {
		assert.deepEqual(await checkUpdate({ os, termux, upgradeFails: true, nextVersion: '2.9.7' }), {
			calls: ['deno upgrade -q stable', 'deno -V'],
			restarts: 1,
			realpaths: [],
		})
	})
}
