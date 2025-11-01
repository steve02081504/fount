import process from 'node:process'

import chalk from 'npm:chalk'
import figlet from 'npm:figlet'

import { setMain } from './base.mjs'


setMain(main)
/**
 * 生成并返回fount的ASCII艺术logo。
 * @returns {Promise<string>} 带有颜色的logo字符串。
 */
async function main() {
	let logo = Array(Math.floor(Math.random() * 7)).fill('fo-').join('') + 'fount!'
	try {
		logo = figlet.textSync(logo, {
			font: 'Pagga',
			width: process.stdout.columns - 1,
			whitespaceBreak: true
		})
	} catch { /* ignore */ }
	return chalk.hex('#0e3c5c')(logo)
}
