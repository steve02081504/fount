import { setMain } from './base.mjs'
setMain(main)
import figlet from 'npm:figlet'
import chalk from 'npm:chalk'
import process from 'node:process'
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
