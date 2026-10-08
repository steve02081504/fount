/**
 * locale 热重载：写入方先截断再写满，watcher 立刻读到半截 JSON 时不得抛错（否则在 fs.watch 回调里
 * 变成未处理拒绝，把跑绿的套件标成 noisy），且同一 locale 的连续事件应合并为一次重载。
 */
/* global Deno */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { assertEquals, assertThrows } from 'jsr:@std/assert'

import { createLocaleReloadScheduler } from '../../i18n/bare.mjs'
import { loadJsonFile } from '../../json_loader.mjs'
import { markTempDirOriginSync } from '../core/temp_origin.mjs'

/**
 * @returns {string} 本次用例的临时目录（已标记来源，调用方负责清理）。
 */
function makeScratchDir() {
	const dir = mkdtempSync(join(tmpdir(), 'fount-locale-reload-'))
	markTempDirOriginSync(dir, 'locale_reload selftest', 'testkit')
	return dir
}

Deno.test('truncated locale JSON is exactly what the watcher must not read directly', () => {
	const dir = makeScratchDir()
	try {
		const empty = join(dir, 'empty.json')
		writeFileSync(empty, '')
		assertThrows(() => loadJsonFile(empty), SyntaxError)

		const halfWritten = join(dir, 'half.json')
		writeFileSync(halfWritten, '{"hello":')
		assertThrows(() => loadJsonFile(halfWritten), SyntaxError)
	}
	finally { rmSync(dir, { recursive: true, force: true }) }
})

Deno.test('locale reload scheduler keeps the old cache and retries while the write is in flight', async () => {
	const dir = makeScratchDir()
	let reads = 0
	const reloaded = []
	const gaveUp = []
	const scheduler = createLocaleReloadScheduler({
		dir,
		debounceMs: 5,
		attempts: 3,
		/**
		 * 模拟写入中的文件：内容为空时返回 null。
		 * @param {string} filename - 文件路径。
		 * @returns {Record<string, unknown> | null} 解析结果或 null。
		 */
		read: filename => {
			reads++
			const text = readFileSync(filename, 'utf8')
			return text.trim() ? JSON.parse(text) : null
		},
		/**
		 * 记录成功重载。
		 * @param {string} locale - locale id。
		 * @param {Record<string, unknown>} data - 新数据。
		 * @returns {void} 无。
		 */
		onReloaded: (locale, data) => { reloaded.push({ locale, data }) },
		/**
		 * 记录用尽放弃。
		 * @param {string} locale - locale id。
		 * @returns {void} 无。
		 */
		onGiveUp: locale => { gaveUp.push(locale) },
	})
	try {
		const target = join(dir, 'zh-CN.json')
		writeFileSync(target, '') // 写入方刚截断，内容还没落盘

		scheduler.notify('zh-CN')
		await delay(80)
		assertEquals(reads, 3, '半截内容应重试到次数用尽')
		assertEquals(reloaded, [], '读不到完整 JSON 时不得重载')
		assertEquals(gaveUp, ['zh-CN'], '用尽后回调一次，且不抛错')
		assertEquals(scheduler.pending(), 0)

		writeFileSync(target, JSON.stringify({ hello: '你好' }))
		scheduler.notify('zh-CN')
		await delay(60)
		assertEquals(reloaded, [{ locale: 'zh-CN', data: { hello: '你好' } }])
		assertEquals(scheduler.pending(), 0)
	}
	finally {
		scheduler.stop()
		rmSync(dir, { recursive: true, force: true })
	}
})

Deno.test('a read that fails mid-flush still lands on the next attempt', async () => {
	let calls = 0
	const reloaded = []
	const scheduler = createLocaleReloadScheduler({
		dir: 'unused',
		debounceMs: 5,
		attempts: 3,
		/**
		 * 前两次读取失败（模拟半截内容），第三次成功。
		 * @returns {Record<string, unknown> | null} 解析结果或 null。
		 */
		read: () => ++calls < 3 ? null : { ok: true },
		/**
		 * 记录成功重载。
		 * @param {string} locale - locale id。
		 * @param {Record<string, unknown>} data - 新数据。
		 * @returns {void} 无。
		 */
		onReloaded: (locale, data) => { reloaded.push({ locale, data }) },
	})
	try {
		scheduler.notify('xx-XX')
		await delay(60)
		assertEquals(calls, 3)
		assertEquals(reloaded, [{ locale: 'xx-XX', data: { ok: true } }])
		assertEquals(scheduler.pending(), 0)
	}
	finally { scheduler.stop() }
})

Deno.test('rapid change events for one locale collapse into a single reload', async () => {
	const dir = makeScratchDir()
	let reads = 0
	const reloaded = []
	const scheduler = createLocaleReloadScheduler({
		dir,
		debounceMs: 20,
		attempts: 2,
		/**
		 * 统计读取次数并返回文件内容。
		 * @param {string} filename - 文件路径。
		 * @returns {Record<string, unknown>} 解析结果。
		 */
		read: filename => {
			reads++
			return JSON.parse(readFileSync(filename, 'utf8'))
		},
		/**
		 * 记录成功重载。
		 * @param {string} locale - locale id。
		 * @param {Record<string, unknown>} data - 新数据。
		 * @returns {void} 无。
		 */
		onReloaded: (locale, data) => { reloaded.push({ locale, data }) },
	})
	try {
		writeFileSync(join(dir, 'ja-JP.json'), JSON.stringify({ a: 1 }))
		scheduler.notify('ja-JP')
		scheduler.notify('ja-JP')
		scheduler.notify('ja-JP')
		assertEquals(scheduler.pending(), 1, '同一 locale 只应有一个待处理任务')
		await delay(90)
		assertEquals(reads, 1, '连续事件应合并为一次读取')
		assertEquals(reloaded, [{ locale: 'ja-JP', data: { a: 1 } }])
		assertEquals(scheduler.pending(), 0)
	}
	finally {
		scheduler.stop()
		rmSync(dir, { recursive: true, force: true })
	}
})
