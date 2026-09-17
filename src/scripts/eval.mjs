/**
 * `fount eval` 的共享 WS 客户端（`path/src/cmd/eval.{ps1,sh}` 都调用它）：
 * 连运行中服务器的 `/ws/eval`，边执行边打印服务端渲染好的文本（流式）。
 * 报错文案本地化：仅在需要报错时才惰性读取 `fountConsole.path.eval.*`。
 */
/* global Deno */
import path from 'node:path'

import { getBestLocale } from '../public/pages/scripts/i18n/locale_match.mjs'

const FOUNT_DIR = path.resolve(import.meta.dirname + '/../../')
const LOCALES_DIR = path.join(FOUNT_DIR, 'src', 'public', 'locales')
const DEFAULT_PORT = 8931

/** @type {Promise<Record<string, string>> | null} 惰性加载的 `fountConsole.path.eval` 文案表；`null` 表示尚未开始加载。 */
let evalMessagesPromise = null

/**
 * 系统语言候选标签（与 path CLI 的 `Get-SystemLocales` 对齐），按优先级排列。
 * @returns {string[]} BCP-47 风格标签
 */
function systemLocales() {
	const locales = []
	try { locales.push(Intl.DateTimeFormat().resolvedOptions().locale) }
	catch { /* 环境不支持 Intl 时忽略 */ }
	for (const name of ['LANG', 'LANGUAGE', 'LC_ALL']) {
		const value = Deno.env.get(name)
		if (!value) continue
		for (const item of value.split(':')) {
			const tag = item.split('.')[0].replace(/_/g, '-')
			if (tag) locales.push(tag)
		}
	}
	return locales
}

/**
 * 惰性读取本地化的 `fountConsole.path.eval` 文案表（仅在报错路径调用）。
 * @returns {Promise<Record<string, string>>} 文案表；读取或解析失败时为空对象（调用方降级为键名）。
 */
function loadEvalMessages() {
	evalMessagesPromise ??= (async () => {
		try {
			const available = (await Deno.readTextFile(path.join(LOCALES_DIR, 'list.csv')))
				.split(/\r?\n/).slice(1)
				.map(line => line.split(',')[0].trim())
				.filter(Boolean)
			const preferred = [Deno.env.get('FOUNT_LOCALE'), ...systemLocales()].filter(Boolean)
			const locale = getBestLocale(preferred, available)
			const data = JSON.parse(await Deno.readTextFile(path.join(LOCALES_DIR, `${locale}.json`)))
			return data?.fountConsole?.path?.eval ?? {}
		}
		catch { return {} }
	})()
	return evalMessagesPromise
}

/**
 * 取本地化消息并插值 `${name}`；键缺失时降级为键名（与 path CLI `Get-I18n` 一致）。
 * @param {string} key `fountConsole.path.eval` 下的键
 * @param {Record<string, string | number>} [params] 插值参数
 * @returns {Promise<string>} 消息文本
 */
async function message(key, params = {}) {
	const messages = await loadEvalMessages()
	const text = typeof messages[key] === 'string' ? messages[key] : key
	return text.replace(/\$\{(\w+)\}/g, (_, name) => String(params[name] ?? ''))
}

/**
 * 从 `data/config.json` 读取端口，失败回落默认值。
 * @returns {Promise<number>} 端口
 */
async function readPort() {
	try {
		const config = JSON.parse(await Deno.readTextFile(path.join(FOUNT_DIR, 'data', 'config.json')))
		if (Number.isFinite(config?.port)) return config.port
	}
	catch { /* 使用默认端口 */ }
	return DEFAULT_PORT
}

let port = await readPort()
/** @type {string | undefined} */
let codeFile
const codeParts = []
for (let i = 0; i < Deno.args.length; i++) {
	const arg = Deno.args[i]
	if (arg === '--port' && Deno.args[i + 1]) { port = Number(Deno.args[++i]); continue }
	if (arg.startsWith('--port=')) { port = Number(arg.slice('--port='.length)); continue }
	if ((arg === '-f' || arg === '--file') && Deno.args[i + 1]) { codeFile = Deno.args[++i]; continue }
	codeParts.push(arg)
}
let code = codeFile ? (await Deno.readTextFile(codeFile)).trim() : codeParts.join(' ').trim()
if (!code && !Deno.stdin.isTerminal())
	code = (await new Response(Deno.stdin.readable).text()).trim()
if (!code) {
	console.error(await message('usage'))
	Deno.exit(1)
}

const encoder = new TextEncoder()
/**
 * 逐字写入服务端渲染好的文本（不补换行/不裁剪）。
 * @param {string} text 文本
 * @returns {void}
 */
const write = text => {
	Deno.stdout.writeSync(encoder.encode(text))
}
const ws = new WebSocket(`ws://localhost:${port}/ws/eval`)

const exitCode = await new Promise(resolve => {
	let settled = false
	ws.addEventListener('open', () => {
		ws.send(JSON.stringify({
			type: 'eval_request',
			id: 'fount-eval',
			code,
			text: true,
			ansi: Deno.stdout.isTerminal(),
		}))
	}, { once: true })
	ws.addEventListener('message', event => {
		let frame
		try {
			frame = JSON.parse(String(event.data))
		}
		catch { return }
		if (frame.type === 'eval_output') {
			// 逐字回显：`stdout.write` 不带换行就保持不带。
			if (typeof frame.text === 'string') write(frame.text)
			return
		}
		if (frame.type === 'eval_result') {
			if (typeof frame.text === 'string') {
				write(frame.text)
				// 结果行没有自带换行时补一个，避免 shell 提示符黏在同一行。
				if (!frame.text.endsWith('\n')) write('\n')
			}
			settled = true
			try { ws.close() } catch { /* ignore */ }
			resolve(frame.error ? 1 : 0)
		}
	})
	ws.addEventListener('error', async () => {
		if (settled) return
		settled = true
		console.error(await message('connectFailed', { port }))
		resolve(1)
	})
	ws.addEventListener('close', async () => {
		if (settled) return
		settled = true
		console.error(await message('disconnected', { port }))
		resolve(1)
	})
})

Deno.exit(exitCode)
