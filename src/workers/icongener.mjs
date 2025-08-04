import { setMain, __dirname } from './base.mjs'
setMain(main)
import { render as resvg } from 'https://deno.land/x/resvg_wasm/mod.ts'
import { default as pngToIco } from 'npm:png-to-ico'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import { nicerWriteFileSync } from '../scripts/nicerWriteFile.mjs'
async function main() {
	const svg = fs.readFileSync(__dirname + '/imgs/icon.svg', 'utf-8')
	const favpngbuf = await resvg(svg).then((buffer) => Buffer.from(buffer))
	nicerWriteFileSync(__dirname + '/src/pages/favicon.png', favpngbuf)
	const favicobuf = await pngToIco(favpngbuf)
	nicerWriteFileSync(__dirname + '/src/pages/favicon.ico', favicobuf)
}
