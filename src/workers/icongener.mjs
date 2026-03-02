import { Buffer } from 'node:buffer'
import fs from 'node:fs'

import { nicerWriteFileSync } from '../scripts/nicerWriteFile.mjs'

import { setMain, __dirname } from './base.mjs'

setMain(main)
/**
 * 生成图标
 */
async function main() {
	const { Resvg } = await import('npm:@resvg/resvg-js')
	const { default: pngToIco } = await import('npm:png-to-ico')
	const svg = fs.readFileSync(__dirname + '/imgs/icon.svg')
	const favpngbuf = Buffer.from(new Resvg(svg, {
		fitTo: {
			mode: 'width',
			value: 1024,
		},
	}).render().asPng())
	nicerWriteFileSync(__dirname + '/src/public/pages/favicon.png', favpngbuf)
	const favicobuf = await pngToIco(favpngbuf)
	nicerWriteFileSync(__dirname + '/src/public/pages/favicon.ico', favicobuf)
}
