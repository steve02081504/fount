import { Buffer } from 'node:buffer'
import fs from 'node:fs'

import { nicerWriteFileSync } from '../scripts/nicerWriteFile.mjs'

import { setMain, __dirname } from './base.mjs'

setMain(main)
/**
 * 生成图标
 */
async function main() {
	const { render: resvg } = await import('https://deno.land/x/resvg_wasm/mod.ts')
	const { default: pngToIco } = await import('npm:png-to-ico')
	const svg = fs.readFileSync(__dirname + '/imgs/icon.svg', 'utf-8')
	const favpngbuf = await resvg(svg).then(buffer => Buffer.from(buffer))
	nicerWriteFileSync(__dirname + '/src/pages/favicon.png', favpngbuf)
	const favicobuf = await pngToIco(favpngbuf)
	nicerWriteFileSync(__dirname + '/src/pages/favicon.ico', favicobuf)
}
