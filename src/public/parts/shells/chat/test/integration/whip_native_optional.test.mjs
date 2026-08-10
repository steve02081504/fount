/**
 * WHIP 的 node-datachannel 为可选原生能力：chat shell / 群路由加载不得静态拉进 addon。
 * Termux（android-arm64）无 prebuild 时静态 import 会 MODULE_NOT_FOUND，整包 shells/chat 挂掉。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

const whipDir = new URL('../../src/chat/whip/', import.meta.url)
const channelStreamingUrl = new URL('../../src/group/routes/channelStreaming.mjs', import.meta.url)

/**
 * 收集文件源码里对 npm:node-datachannel 的静态 import 行。
 * @param {URL} file 源文件
 * @returns {Promise<string[]>} `line:…` 命中
 */
async function staticNodeDatachannelImportsInFile(file) {
	const text = await Deno.readTextFile(file)
	/** @type {string[]} */
	const hits = []
	const lines = text.split(/\r?\n/)
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		if (/^\s*import\s+/.test(line) && /node-datachannel/.test(line))
			hits.push(`${i + 1}:${line.trim()}`)
	}
	return hits
}

/**
 * 收集目录内 .mjs 源码里对 npm:node-datachannel 的静态 import 行。
 * @param {URL} dir whip 目录
 * @returns {Promise<string[]>} `file:line:…` 命中
 */
async function staticNodeDatachannelImports(dir) {
	/** @type {string[]} */
	const hits = []
	for await (const entry of Deno.readDir(dir)) {
		if (!entry.isFile || !entry.name.endsWith('.mjs')) continue
		for (const hit of await staticNodeDatachannelImportsInFile(new URL(entry.name, dir)))
			hits.push(`${entry.name}:${hit}`)
	}
	return hits
}

Deno.test('whip modules must not statically import node-datachannel', async () => {
	const hits = await staticNodeDatachannelImports(whipDir)
	assertEquals(hits, [], `eager native import breaks Termux chat load:\n${hits.join('\n')}`)
})

Deno.test('channelStreaming must not statically import whip ingest (native graph)', async () => {
	const text = await Deno.readTextFile(channelStreamingUrl)
	const staticWhip = [...text.matchAll(/^\s*import\s+.+whip\//gm)].map(m => m[0].trim())
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
