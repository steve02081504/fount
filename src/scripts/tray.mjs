import { shutdown } from '../server/on_shutdown.mjs'
import { __dirname } from '../server/server.mjs'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
const SysTray = (await import('npm:systray')).default.default //??????
import { geti18n } from '../scripts/i18n.mjs'

async function getBase64Icon(iconPath) {
	try {
		const iconData = fs.readFileSync(iconPath)
		return iconData.toString('base64')
	} catch (err) {
		console.error(await geti18n('fountConsole.tray.readIconFailed', { error: err }))
		return ''
	}
}

export async function createTray() {
	try {
		let iconPath = ''
		const platform = os.platform()

		if (platform === 'win32')
			iconPath = path.join(__dirname, '/src/public/favicon.ico')
		else
			iconPath = path.join(__dirname, '/imgs/icon.png')

		const base64Icon = await getBase64Icon(iconPath)

		const systray = new SysTray({
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
				systray.kill()
				shutdown()
			}
		})
	} catch (err) {
		console.error(await geti18n('fountConsole.tray.createTrayFailed', { error: err }))
	}
}
