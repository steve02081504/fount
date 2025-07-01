import { on_shutdown } from '../server/on_shutdown.mjs'
import { __dirname } from '../server/server.mjs'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
const SysTray = (await import('npm:systray').catch(_ => 0))?.default?.default //??????
import { geti18n } from '../scripts/i18n.mjs'
import process from 'node:process'

async function getBase64Icon(iconPath) {
	try {
		const iconData = fs.readFileSync(iconPath)
		return iconData.toString('base64')
	} catch (err) {
		console.error(await geti18n('fountConsole.tray.readIconFailed', { error: err }))
		return ''
	}
}

let systray

on_shutdown(() => {
	systray?.kill?.()
	systray = null
})

export async function createTray() {
	try {
		if (systray) systray.kill()
		systray = null
		let iconPath = ''
		const platform = os.platform()

		if (platform === 'win32')
			iconPath = path.join(__dirname, '/src/pages/favicon.ico')
		else
			iconPath = path.join(__dirname, '/imgs/icon.png')

		const base64Icon = await getBase64Icon(iconPath)

		systray = new SysTray({
			menu: {
				icon: base64Icon,
				title: 'Fount',
				tooltip: 'Fount',
				items: [
					{
						title: 'Exit',
						tooltip: 'Exit application',
						checked: false,
						enabled: true
					}
				]
			},
			debug: false,
			copyDir: true
		})

		systray.onClick(action => {
			if (action.seq_id === 0) {
				systray?.kill?.()
				systray = null
				process.exit()
			}
		})

		return systray
	} catch (err) {
		console.error(await geti18n('fountConsole.tray.createTrayFailed', { error: err }))
	}
}
