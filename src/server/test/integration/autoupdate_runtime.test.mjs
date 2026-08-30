/** 空闲时更新运行时须尊重 pacman 所有权，并只操作正在运行的可执行文件。 */
/* global Deno */
import assert from 'node:assert/strict'

import { autoUpdateEnabled, disableAutoUpdate, enableAutoUpdate } from '../../autoupdate.mjs'

import { idleHandlers, updateFixture } from './fixtures/autoupdate.mjs'

const initialExecPath = Deno.execPath()

/**
 * 通过真实模块的空闲回调运行更新，外部调用由限定导入范围的夹具接管。
 * @param {object} [options] 系统、所有权与版本夹具。
 * @param {string} [options.os] 运行时报告的操作系统。
 * @param {boolean} [options.managed] 当前可执行文件是否由 pacman 管理。
 * @param {string} [options.version] 运行中的 Deno 版本。
 * @param {string} [options.nextVersion] 升级后查询到的 Deno 版本。
 * @param {boolean} [options.missingPacman] 是否模拟 pacman 不存在。
 * @param {string} [options.execPath] 模块加载后运行时报告的可执行文件路径。
 * @param {string} [options.resolvedPath] 跟随符号链接后得到的真实路径。
 * @returns {Promise<{calls: Array, restarts: number, realpaths: string[]}>} 外部调用、重启计数和解析路径。
 */
async function checkUpdate({ os = 'linux', managed = false, version = '2.9.6', nextVersion = version, missingPacman = false, execPath = initialExecPath, resolvedPath = '/opt/User Deno/bin/deno/resolved' } = {}) {
	const originalBuild = Deno.build
	const originalVersion = Deno.version
	const originalExecPath = Deno.execPath
	Object.assign(updateFixture, { managed, nextVersion, missingPacman, resolvedPath, calls: [], restarts: 0, realpaths: [] })
	try {
		Deno.build = { ...originalBuild, os }
		Deno.version = { ...originalVersion, deno: version }
		/**
		 * 返回本用例指定的运行时路径。
		 * @returns {string} 运行中的可执行文件路径。
		 */
		Deno.execPath = () => execPath
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
		realpaths: [initialExecPath],
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
			realpaths: [initialExecPath],
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
		realpaths: [initialExecPath],
	})
})

for (const managed of [true, false])
	Deno.test(`idle update retains the startup executable after Linux replaces it (pacman managed: ${managed})`, async () => {
		assert.deepEqual(await checkUpdate({ managed, execPath: '/usr/bin/deno (deleted)', resolvedPath: '/usr/bin/deno' }), {
			calls: [
				['pacman', ['-Qqo', '--', '/usr/bin/deno']],
				...managed ? [] : [['/usr/bin/deno', ['upgrade', '-q', 'stable']], ['/usr/bin/deno', ['-V']]],
			],
			restarts: 0,
			realpaths: [initialExecPath],
		})
	})

for (const os of ['windows', 'darwin'])
	Deno.test(`idle update on ${os} does not query pacman`, async () => {
		assert.deepEqual((await checkUpdate({ os })).calls, [
			['/opt/User Deno/bin/deno/resolved', ['upgrade', '-q', 'stable']],
			['/opt/User Deno/bin/deno/resolved', ['-V']],
		])
	})
