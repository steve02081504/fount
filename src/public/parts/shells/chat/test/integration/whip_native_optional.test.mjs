/**
 * WHIP 的 node-datachannel 为可选原生能力：chat shell / 群路由加载不得静态拉进 addon。
 * Termux（android-arm64）无 prebuild 时静态 import 会 MODULE_NOT_FOUND，整包 shells/chat 挂掉。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

const whipDir = new URL('../../src/chat/whip/', import.meta.url)
const channelStreamingUrl = new URL('../../src/group/routes/channelStreaming.mjs', import.meta.url)

/**
 * @param {string} text 源码
 * @param {number} index 当前位置
 * @returns {boolean} 是否标识符续写字符
 */
function isIdentContinue(text, index) {
	const code = text.charCodeAt(index)
	return code >= 48 && code <= 57
		|| code >= 65 && code <= 90
		|| code >= 97 && code <= 122
		|| code === 36
		|| code === 95
}

/**
 * @param {string} text 源码
 * @param {number} openIndex 开引号位置
 * @param {string} quote 引号字符
 * @returns {number} 引号结束后的下标
 */
function skipString(text, openIndex, quote) {
	let index = openIndex + 1
	while (index < text.length) {
		const character = text[index]
		if (character === '\\') {
			index += 2
			continue
		}
		if (character === quote) return index + 1
		if (quote === '`' && character === '$' && text[index + 1] === '{') {
			index += 2
			let depth = 1
			while (index < text.length && depth) {
				if (text[index] === '"' || text[index] === '\'' || text[index] === '`') {
					index = skipString(text, index, text[index])
					continue
				}
				if (text[index] === '{') depth++
				else if (text[index] === '}') depth--
				index++
			}
			continue
		}
		index++
	}
	return text.length
}

/**
 * @param {string} text 源码
 * @param {number} index `/*` 起点
 * @returns {number} 注释结束后的下标
 */
function skipBlockComment(text, index) {
	const end = text.indexOf('*/', index + 2)
	return end < 0 ? text.length : end + 2
}

/**
 * @param {string} text 源码
 * @param {number} index `//` 起点
 * @returns {number} 行注释结束后的下标
 */
function skipLineComment(text, index) {
	const end = text.indexOf('\n', index)
	return end < 0 ? text.length : end + 1
}

/**
 * @param {string} text 源码
 * @param {number} fromIndex 当前位置
 * @returns {number} 跳过空白与注释后的下标
 */
function skipSpaceAndComments(text, fromIndex) {
	let index = fromIndex
	while (index < text.length) {
		const character = text[index]
		if (character === ' ' || character === '\t' || character === '\n' || character === '\r') {
			index++
			continue
		}
		if (character === '/' && text[index + 1] === '*') {
			index = skipBlockComment(text, index)
			continue
		}
		if (character === '/' && text[index + 1] === '/') {
			index = skipLineComment(text, index)
			continue
		}
		break
	}
	return index
}

/**
 * 从 `from` 起扫描到模块字符串字面量结束。
 * @param {string} text 源码
 * @param {number} fromIndex `from` 关键字起点
 * @returns {number} 声明结束后的下标；失败为 -1
 */
function scanFromModuleSpecifier(text, fromIndex) {
	const index = skipSpaceAndComments(text, fromIndex + 4)
	const quote = text[index]
	if (quote !== '"' && quote !== '\'') return -1
	return skipString(text, index, quote)
}

/**
 * @param {string} text 源码
 * @param {number} importIndex `import` 起点
 * @returns {number} 声明结束后的下标；非静态 import 为 -1
 */
function scanImportDeclaration(text, importIndex) {
	let index = skipSpaceAndComments(text, importIndex + 6)
	const quote = text[index]
	if (quote === '"' || quote === '\'')
		return skipString(text, index, quote)

	while (index < text.length) {
		index = skipSpaceAndComments(text, index)
		if (text.startsWith('from', index) && !isIdentContinue(text, index + 4))
			return scanFromModuleSpecifier(text, index)
		const character = text[index]
		if (character === '"' || character === '\'' || character === '`') {
			index = skipString(text, index, character)
			continue
		}
		if (character === '/' && text[index + 1] === '*') {
			index = skipBlockComment(text, index)
			continue
		}
		if (character === '/' && text[index + 1] === '/') {
			index = skipLineComment(text, index)
			continue
		}
		if (character === ';' || character === '\n') return -1
		index++
	}
	return -1
}

/**
 * @param {string} text 源码
 * @param {number} exportIndex `export` 起点
 * @returns {number} 声明结束后的下标；非 `export … from` 为 -1
 */
function scanExportNamedFromDeclaration(text, exportIndex) {
	let index = skipSpaceAndComments(text, exportIndex + 6)
	if (text[index] !== '{' && !text.startsWith('*', index)) return -1
	while (index < text.length) {
		index = skipSpaceAndComments(text, index)
		if (text.startsWith('from', index) && !isIdentContinue(text, index + 4))
			return scanFromModuleSpecifier(text, index)
		const character = text[index]
		if (character === '"' || character === '\'' || character === '`') {
			index = skipString(text, index, character)
			continue
		}
		if (character === '/' && text[index + 1] === '*') {
			index = skipBlockComment(text, index)
			continue
		}
		if (character === '/' && text[index + 1] === '/') {
			index = skipLineComment(text, index)
			continue
		}
		if (character === ';' || character === '\n') return -1
		index++
	}
	return -1
}

/**
 * 收集源码里对目标模块的静态 ImportDeclaration / ExportNamedDeclaration（含 side-effect import）。
 * 跳过字符串、块注释与行注释后再识别声明。
 * @param {string} text 源文件
 * @param {RegExp} modulePattern 模块路径匹配
 * @returns {string[]} 命中声明原文
 */
function staticModuleDeclarations(text, modulePattern) {
	/** @type {string[]} */
	const hits = []
	let index = 0
	while (index < text.length) {
		const character = text[index]
		if (character === '"' || character === '\'' || character === '`') {
			index = skipString(text, index, character)
			continue
		}
		if (character === '/' && text[index + 1] === '*') {
			index = skipBlockComment(text, index)
			continue
		}
		if (character === '/' && text[index + 1] === '/') {
			index = skipLineComment(text, index)
			continue
		}

		if ((character === 'i' || character === 'e') && (index === 0 || !isIdentContinue(text, index - 1))) {
			if (text.startsWith('import', index) && !isIdentContinue(text, index + 6)) {
				const end = scanImportDeclaration(text, index)
				if (end > index) {
					const statement = text.slice(index, end).replace(/\s+/g, ' ').trim()
					if (modulePattern.test(statement)) hits.push(statement)
					index = end
					continue
				}
			}
			if (text.startsWith('export', index) && !isIdentContinue(text, index + 6)) {
				const end = scanExportNamedFromDeclaration(text, index)
				if (end > index) {
					const statement = text.slice(index, end).replace(/\s+/g, ' ').trim()
					if (modulePattern.test(statement)) hits.push(statement)
					index = end
					continue
				}
			}
		}
		index++
	}
	return hits
}

/**
 * 收集文件源码里对 npm:node-datachannel 的静态 import 声明。
 * @param {URL} file 源文件
 * @returns {Promise<string[]>} 命中
 */
async function staticNodeDatachannelImportsInFile(file) {
	const text = await Deno.readTextFile(file)
	return staticModuleDeclarations(text, /node-datachannel/)
}

/**
 * 收集目录内 .mjs 源码里对 npm:node-datachannel 的静态 import。
 * @param {URL} dir whip 目录
 * @returns {Promise<string[]>} `file:…` 命中
 */
async function staticNodeDatachannelImports(dir) {
	/** @type {string[]} */
	const hits = []
	for await (const entry of Deno.readDir(dir)) {
		if (entry.isDirectory) {
			for (const hit of await staticNodeDatachannelImports(new URL(`${entry.name}/`, dir)))
				hits.push(`${entry.name}/${hit}`)
			continue
		}
		if (!entry.isFile || !entry.name.endsWith('.mjs')) continue
		for (const hit of await staticNodeDatachannelImportsInFile(new URL(entry.name, dir)))
			hits.push(`${entry.name}:${hit}`)
	}
	return hits
}

Deno.test('staticModuleDeclarations catches multiline node-datachannel import', () => {
	const fixture = `
import {
	PeerConnection,
} from 'npm:node-datachannel'
export { x } from './ok.mjs'
`
	assertEquals(
		staticModuleDeclarations(fixture, /node-datachannel/),
		['import { PeerConnection, } from \'npm:node-datachannel\''],
	)
})

Deno.test('staticModuleDeclarations ignores import text inside comments and strings', () => {
	const fixture = `
const source = "import x from 'npm:node-datachannel'"
/* import y from 'npm:node-datachannel' */
// import z from 'npm:node-datachannel'
import { PeerConnection } from 'npm:node-datachannel'
`
	assertEquals(
		staticModuleDeclarations(fixture, /node-datachannel/),
		['import { PeerConnection } from \'npm:node-datachannel\''],
	)
})

Deno.test('whip modules must not statically import node-datachannel', async () => {
	const hits = await staticNodeDatachannelImports(whipDir)
	assertEquals(hits, [], `eager native import breaks Termux chat load:\n${hits.join('\n')}`)
})

Deno.test('channelStreaming must not statically import whip ingest (native graph)', async () => {
	const text = await Deno.readTextFile(channelStreamingUrl)
	const staticWhip = staticModuleDeclarations(text, /whip\//)
	assertEquals(staticWhip, [], `static whip import pulls native into chat route load:\n${staticWhip.join('\n')}`)
})

Deno.test('whip sdp/ingest import without requiring native addon at module evaluate', async () => {
	const { parseOfferMedia, acceptWhipOffer } = await import('../../src/chat/whip/sdp.mjs')
	const { startWhipIngest, stopWhipIngest } = await import('../../src/chat/whip/ingest.mjs')
	assertEquals(typeof acceptWhipOffer, 'function')
	assertEquals(typeof startWhipIngest, 'function')
	assertEquals(typeof stopWhipIngest, 'function')
	const info = parseOfferMedia([
		'v=0',
		'm=video 9 UDP/TLS/RTP/SAVPF 96',
		'a=rtpmap:96 H264/90000',
		'a=mid:video',
	].join('\r\n'))
	assertEquals(info.h264Pt, 96)
})
