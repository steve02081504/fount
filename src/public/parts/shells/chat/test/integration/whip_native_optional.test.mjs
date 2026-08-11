/**
 * WHIP 的 node-datachannel 为可选原生能力：chat shell / 群路由加载不得静态拉进 addon。
 * Termux（android-arm64）无 prebuild 时静态 import 会 MODULE_NOT_FOUND，整包 shells/chat 挂掉。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

const whipDir = new URL('../../src/chat/whip/', import.meta.url)
const channelStreamingUrl = new URL('../../src/group/routes/channelStreaming.mjs', import.meta.url)

/**
 * 去掉行注释后拼接源码，便于跨行匹配静态 import/export。
 * @param {string} text 源文件
 * @returns {string} 去注释文本
 */
function stripLineComments(text) {
	return text.replace(/^\s*\/\/.*$/gm, '')
}

/**
 * 收集源码里对目标模块的静态 import/export 声明（支持多行）。
 * @param {string} text 源文件
 * @param {RegExp} modulePattern 模块路径匹配
 * @returns {string[]} 命中声明原文
 */
function staticModuleDeclarations(text, modulePattern) {
	const body = stripLineComments(text)
	/** @type {string[]} */
	const hits = []
	const re = /\b(?:import|export)\s+[\s\S]*?from\s*['"][^'"]+['"]/g
	for (const match of body.matchAll(re)) {
		const statement = match[0].replace(/\s+/g, ' ').trim()
		if (modulePattern.test(statement)) hits.push(statement)
	}
	// side-effect: import 'mod'
	const sideEffect = /\bimport\s*['"][^'"]+['"]/g
	for (const match of body.matchAll(sideEffect)) 
		if (modulePattern.test(match[0])) hits.push(match[0].trim())
	
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
