import fs from 'node:fs'
import os from 'node:os'
import process from 'node:process'

import { on_shutdown } from 'npm:on-shutdown'
import open from 'npm:open'

import { console, geti18n } from '../scripts/i18n.mjs'
import { __dirname } from '../server/base.mjs'
import { hosturl, restartor } from '../server/server.mjs'

const SysTray = (await import('npm:systray').catch(_ => 0))?.default?.default //??????
// systray2 不好用，Windows下图标会时不时消失，尝试过了，详见 7ef383c550663d9f1df051854df925e94e04025f

async function getBase64Icon(iconPath) {
	try {
		const iconData = fs.readFileSync(iconPath)
		return iconData.toString('base64')
	}
	catch (err) {
		console.errorI18n('fountConsole.tray.readIconFailed', { error: err })
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
		const iconPath = __dirname + (os.platform() === 'win32' ? '/src/pages/favicon.ico' : '/src/pages/favicon.png')
		const base64Icon = await getBase64Icon(iconPath)

		systray = new SysTray({
			menu: {
				icon: base64Icon,
				title: geti18n('fountConsole.tray.title'),
				tooltip: geti18n('fountConsole.tray.tooltip'),
				items: [
					{
						title: geti18n('fountConsole.tray.items.open.title'),
						tooltip: geti18n('fountConsole.tray.items.open.tooltip'),
						checked: false,
						enabled: true
					},
					{
						title: geti18n('fountConsole.tray.items.github.title'),
						tooltip: geti18n('fountConsole.tray.items.github.tooltip'),
						checked: false,
						enabled: true
					},
					{
						title: geti18n('fountConsole.tray.items.discord.title'),
						tooltip: geti18n('fountConsole.tray.items.discord.tooltip'),
						checked: false,
						enabled: true
					},
					{
						title: geti18n('fountConsole.tray.items.restart.title'),
						tooltip: geti18n('fountConsole.tray.items.restart.tooltip'),
						checked: false,
						enabled: true
					},
					{
						title: geti18n('fountConsole.tray.items.exit.title'),
						tooltip: geti18n('fountConsole.tray.items.exit.tooltip'),
						checked: false,
						enabled: true
					}
				]
			},
			debug: false,
			copyDir: false
		})

		systray.onClick(action => {
			switch (action.seq_id) {
				case 0:
					open(hosturl)
					break
				case 1:
					open('https://github.com/steve02081504/fount')
					break
				case 2:
					open('https://discord.gg/GtR9Quzq2v')
					break
				case 3:
					restartor()
					break
				case 4:
					process.exit(0)
			}
		})

		return systray
	}
	catch (err) {
		console.errorI18n('fountConsole.tray.createTrayFailed', { error: err })
	}
}
