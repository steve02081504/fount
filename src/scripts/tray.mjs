import { on_shutdown } from 'npm:on-shutdown'
import { __dirname } from '../server/server.mjs'
import fs from 'node:fs'
import os from 'node:os'
const SysTray = (await import('npm:systray').catch(_ => 0))?.default?.default //??????
import { geti18n } from '../scripts/i18n.mjs'
import process from 'node:process'
import open from 'npm:open'

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
			iconPath = __dirname + '/src/pages/favicon.ico'
		else
			iconPath = __dirname + '/src/pages/favicon.png'

		const base64Icon = await getBase64Icon(iconPath)

		systray = new SysTray({
			menu: {
				icon: base64Icon,
				title: 'Fount',
				tooltip: 'Fount',
				items: [
					{
						title: 'Open',
						tooltip: 'Open fount',
						checked: false,
						enabled: true
					},
					{
						title: 'github',
						tooltip: 'Open founts github',
						checked: false,
						enabled: true
					},
					{
						title: 'Discord',
						tooltip: 'Open founts discord',
						checked: false,
						enabled: true
					},
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
			switch(action.seq_id) {
				case 0:
					open('https://steve02081504.github.io/fount/wait')
					break
				case 1:
					open('https://github.com/steve02081504/fount')
					break
				case 2:
					open('https://discord.gg/GtR9Quzq2v')
					break
				case 3:
					process.exit(0)
			}
		})

		return systray
	} catch (err) {
		console.error(await geti18n('fountConsole.tray.createTrayFailed', { error: err }))
	}
}
