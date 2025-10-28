import fs from 'node:fs'
import os from 'node:os'
import process from 'node:process'

import { on_shutdown } from 'npm:on-shutdown'
import open from 'npm:open'

import { console, geti18n } from '../scripts/i18n.mjs'
import { __dirname } from '../server/base.mjs'
import { hosturl, restartor } from '../server/server.mjs'

const SysTray = (await import('npm:systray2').catch(_ => 0))?.default?.default //??????

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

		systray = new SysTray({
			menu: {
				icon: iconPath,
				title: geti18n('fountConsole.tray.title'),
				tooltip: geti18n('fountConsole.tray.tooltip'),
				items: [
					{
						title: geti18n('fountConsole.tray.items.open.title'),
						tooltip: geti18n('fountConsole.tray.items.open.tooltip'),
						checked: false,
						enabled: true,
						click: () => open(hosturl)
					},
					{
						title: geti18n('fountConsole.tray.items.github.title'),
						tooltip: geti18n('fountConsole.tray.items.github.tooltip'),
						checked: false,
						enabled: true,
						click: () => open('https://github.com/steve02081504/fount')
					},
					{
						title: geti18n('fountConsole.tray.items.discord.title'),
						tooltip: geti18n('fountConsole.tray.items.discord.tooltip'),
						checked: false,
						enabled: true,
						click: () => open('https://discord.gg/GtR9Quzq2v')
					},
					SysTray.separator,
					{
						title: geti18n('fountConsole.tray.items.restart.title'),
						tooltip: geti18n('fountConsole.tray.items.restart.tooltip'),
						checked: false,
						enabled: true,
						click: () => restartor()
					},
					{
						title: geti18n('fountConsole.tray.items.exit.title'),
						tooltip: geti18n('fountConsole.tray.items.exit.tooltip'),
						checked: false,
						enabled: true,
						click: () => process.exit(0)
					}
				]
			},
			debug: false,
			copyDir: false
		})

		systray.onClick(action => {
			action.item?.click?.()
		})

		await systray.ready()
		return systray
	}
	catch (err) {
		console.errorI18n('fountConsole.tray.createTrayFailed', { error: err })
	}
}
