/* global Deno */
/* eslint jsdoc/require-jsdoc: off */
/**
 * file-operations agent 工具的可复现本地基准。从仓库根用 Deno 运行；
 * 说明见同目录的 `docs/file_tools.md`。
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

import { fileOperationsReplyHandlers } from 'fount/public/parts/plugins/file-operations/handler.mjs'
import { buildFileEditSummary, renderLineDiff } from 'fount/public/parts/plugins/file-operations/src/edit_safety.mjs'
import { runReplyHandlers } from 'fount/public/parts/shells/chat/src/reply/handlerPipeline.mjs'

import { markTempDirOriginSync } from '../../core/temp_origin.mjs'

const allowedArgs = new Set(['iterations', 'output'])
const options = new Map()
for (const value of Deno.args) {
	const match = value.match(/^--([^=]+)=(.*)$/)
	if (!match || !allowedArgs.has(match[1]) || options.has(match[1]))
		throw new Error(`Invalid or duplicate option: ${value}`)
	options.set(match[1], match[2])
}
const iterations = Number(options.get('iterations') ?? 9)
if (!Number.isInteger(iterations) || iterations <= 0)
	throw new Error('--iterations must be a positive integer')
const warmups = 2
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fount-agent-file-bench-'))
markTempDirOriginSync(root, 'agent file tools benchmark')
const originalInfo = console.info
const originalLog = console.log

/**
 * 生成稳定的搜索夹具内容。
 * @param {number} index - 夹具编号。
 * @returns {string} 确定性文本。
 */
function fixtureText(index) {
	return Array.from({ length: 40 }, (_, line) => `file=${index} line=${line} ${line % 7 === 0 ? 'DENSE_MATCH' : 'ordinary content'}\n`).join('')
}

/**
 * 填充临时搜索与编辑工作区。
 * @returns {Promise<void>} 文件就绪。
 */
async function seed() {
	await fs.mkdir(path.join(root, 'nested'), { recursive: true })
	for (let i = 0; i < 300; i++)
		await fs.writeFile(path.join(root, i % 3 ? 'nested' : '', `fixture-${String(i).padStart(3, '0')}.txt`), fixtureText(i))
	await fs.writeFile(path.join(root, 'edit.txt'), 'before\n')
}

/**
 * 调用一个文件工具并收集其面向 agent 的结果。
 * @param {string} xml - 工具调用标记。
 * @returns {Promise<{output: string, logs: object[], inputBytes: number}>} 收集到的结果。
 */
async function runTool(xml) {
	const logs = []
	const args = {
		Charname: 'BenchChar', username: 'bench-user',
		workdir: { machine: '0', path: root }, chat_scoped_char_memory: {},
		AddLongTimeLog: entry => logs.push(entry),
	}
	console.info = () => {}
	console.log = () => {}
	try { await runReplyHandlers({ content: xml, extension: {} }, args, fileOperationsReplyHandlers) }
	finally { console.info = originalInfo; console.log = originalLog }
	const output = logs.map(entry => entry.content ?? '').join('\n')
	return { output, logs, inputBytes: new TextEncoder().encode(xml).byteLength }
}

/**
 * 从升序样本中取分位。
 * @param {number[]} sorted - 按升序排序的耗时。
 * @param {number} fraction - 0 到 1 的分位。
 * @returns {number} 选中的耗时。
 */
function percentile(sorted, fraction) { return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] }

/**
 * 测量一次冷调用与多次热调用。
 * @param {string} name - 用例名。
 * @param {(iteration: number) => Promise<object>} operation - 被测操作。
 * @param {(result: object) => void|Promise<void>} check - 正确性断言。
 * @param {() => Promise<void>} [prepare] - 每次计时前的状态重置。
 * @returns {Promise<object>} 耗时与输出体积统计。
 */
async function measure(name, operation, check, prepare = async () => {}) {
	const samples = []
	let outputBytes = 0
	let inputBytes = 0
	await prepare()
	const coldStart = performance.now()
	const coldResult = await operation(-1)
	const coldMs = performance.now() - coldStart
	await check(coldResult)
	for (let i = 0; i < warmups + iterations; i++) {
		await prepare()
		const start = performance.now()
		const result = await operation(i)
		const elapsed = performance.now() - start
		await check(result)
		if (i >= warmups) {
			samples.push(elapsed)
			outputBytes = new TextEncoder().encode(result.output ?? '').byteLength
			inputBytes = result.inputBytes ?? 0
		}
	}
	const sorted = [...samples].sort((a, b) => a - b)
	return { name, iterations, coldMs: Number(coldMs.toFixed(3)), warmMedianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(3)), warmP95Ms: Number(percentile(sorted, .95).toFixed(3)), inputBytes, outputBytes }
}

/**
 * 基准测试一次真实的 override-file 新建或覆盖，并在计时后校验。
 * @param {string} name - 用例名。
 * @param {string} filename - 工作区相对目标路径。
 * @param {string} content - 提供给工具的文件内容。
 * @param {string|null} [existingText] - 已有内容；null 表示新建。
 * @returns {Promise<object>} 写入用例的计时结果。
 */
async function measureWriteCase(name, filename, content, existingText = null) {
	const filepath = path.join(root, filename)
	const expected = `${content}\n`
	const xml = `<override-file path="${filename}" force="true">${content}</override-file>`
	return await measure(name, () => runTool(xml), async result => {
		const actual = await fs.readFile(filepath, 'utf8')
		if (actual !== expected) throw new Error(`${name} file content verification failed`)
		const edit = result.logs.at(-1)?.extension?.pluginData?.['file-operations']?.edit
		if (edit?.path !== filename) throw new Error(`${name} edit summary verification failed`)
	}, async () => {
		if (existingText == null) await fs.rm(filepath, { force: true })
		else await fs.writeFile(filepath, existingText)
	})
}

try {
	await seed()
	const results = []
	results.push(await measure('glob', () => runTool('<glob path=".">**/fixture-*.txt</glob>'), result => {
		if (!result.output.includes('命中 300 个') || !result.output.includes('fixture-000.txt')) throw new Error('glob correctness check failed')
	}))
	results.push(await measure('grep', () => runTool('<grep path="." include="*.txt">DENSE_MATCH</grep>'), result => {
		if (!result.output.includes('命中 1800 处（仅显示前 200 处）') || !result.output.includes('DENSE_MATCH')) throw new Error(`dense grep limit correctness check failed: ${result.output.slice(0, 300)}`)
	}))
	results.push(await measure('grep-files', () => runTool('<grep path="." mode="files" include="*.txt">DENSE_MATCH</grep>'), result => {
		if (!result.output.includes('命中 300 个文件') || !result.output.includes('fixture-000.txt')) throw new Error(`grep files correctness check failed: ${result.output.slice(0, 300)}`)
	}))
	results.push(await measure('view-file', () => runTool('<view-file path=".">fixture-000.txt</view-file>'), result => {
		if (!result.output.includes('file=0 line=0 DENSE_MATCH')) throw new Error('view-file correctness check failed')
	}))
	results.push(await measureWriteCase('write-file-new-small', 'write-new-small.txt', 'new file content'))
	results.push(await measureWriteCase('write-file-overwrite-small', 'write-overwrite-small.txt', 'replacement content', 'distinct prior content\n'))
	results.push(await measure('replace-file', () => runTool('<replace-file><file path="edit.txt"><replacement><search>before</search><replace>after</replace></replacement></file></replace-file>'), async result => {
		const fileText = await fs.readFile(path.join(root, 'edit.txt'), 'utf8')
		const edit = result.logs.at(-1)?.extension?.pluginData?.['file-operations']?.edit
		if (fileText !== 'after\n' || edit?.added !== 1 || edit?.removed !== 1) throw new Error('replace-file correctness check failed')
	}, () => fs.writeFile(path.join(root, 'edit.txt'), 'before\n')))
	for (const lineCount of [10000, 50000]) {
		const oldText = Array.from({ length: lineCount }, (_, i) => `old line ${i}`).join('\n')
		const newText = Array.from({ length: lineCount }, (_, i) => `new line ${i}`).join('\n')
		results.push(await measureWriteCase(`write-file-new-${lineCount}`, `write-new-${lineCount}.txt`, newText))
		results.push(await measureWriteCase(`write-file-overwrite-${lineCount}`, `write-overwrite-${lineCount}.txt`, newText, oldText))
		results.push(await measure(`replace-file-full-${lineCount}`, () => runTool(`<replace-file><file path="large-edit.txt"><replacement><search>${oldText}</search><replace>${newText}</replace></replacement></file></replace-file>`), async result => {
			const fileText = await fs.readFile(path.join(root, 'large-edit.txt'), 'utf8')
			const edit = result.logs.at(-1)?.extension?.pluginData?.['file-operations']?.edit
			if (fileText !== newText || edit?.added !== lineCount || edit?.removed !== lineCount) throw new Error(`replace-file full ${lineCount} correctness check failed`)
		}, () => fs.writeFile(path.join(root, 'large-edit.txt'), oldText)))
		results.push(await measure(`renderLineDiff-${lineCount}`, () => ({ output: renderLineDiff(oldText, newText) }), result => {
			if (!result.output.includes('未显示')) throw new Error(`renderLineDiff ${lineCount} correctness check failed`)
		}))
		results.push(await measure(`buildFileEditSummary-${lineCount}`, () => {
			const summary = buildFileEditSummary('large.txt', oldText, newText)
			return { output: `${summary.added},${summary.removed},${summary.diff}` }
		}, result => {
			if (!result.output.startsWith(`${lineCount},${lineCount},`) || !result.output.includes('未显示')) throw new Error(`buildFileEditSummary ${lineCount} correctness check failed`)
		}))
	}
	const oldWrite1000 = Array.from({ length: 1000 }, (_, i) => `prior line ${i}`).join('\n')
	const newWrite1000 = Array.from({ length: 1000 }, (_, i) => `replacement line ${i}`).join('\n')
	results.push(await measureWriteCase('write-file-overwrite-1000', 'write-overwrite-1000.txt', newWrite1000, oldWrite1000))
	const json = JSON.stringify({ schema: 1, generatedAt: new Date().toISOString(), platform: `${process.platform}-${process.arch}`, node: process.version, deno: Deno.version, iterations, warmups, fixture: { files: 301, linesPerSearchFile: 40 }, results }, null, 2)
	if (options.has('output')) await fs.writeFile(path.resolve(options.get('output')), `${json}\n`)
	else console.log(json)
}
finally {
	console.info = originalInfo
	console.log = originalLog
	await fs.rm(root, { recursive: true, force: true })
}
