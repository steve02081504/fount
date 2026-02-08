import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import process from 'node:process'

import { on_shutdown } from 'npm:on-shutdown'
import open from 'npm:open'
import supportsAnsi from 'npm:supports-ansi'

import { in_docker, in_termux } from '../scripts/env.mjs'
import { console, geti18n } from '../scripts/i18n.mjs'
import { __dirname } from '../server/base.mjs'
import { hosturl, restartor } from '../server/server.mjs'

/**
 * 获取图标的 base64 编码。
 * @param {string} iconPath - 图标文件的路径。
 * @returns {Promise<string>} 一个解析为图标的 base64 编码的承诺。
 */
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

/**
 * 创建系统托盘菜单。
 * @returns {Promise<object|undefined>} 创建的托盘对象或在出错时返回undefined。
 */
export async function createTray() {
	if (in_docker || in_termux) return
	try {
		const terminalWorks = process.stdout.writable
		if (systray) systray.kill()
		systray = null
		const iconPath = __dirname + (os.platform() === 'win32' ? '/src/public/pages/favicon.ico' : '/src/public/pages/favicon.png')
		const base64Icon = await getBase64Icon(iconPath)

		const SysTray = (await import('npm:systray').catch(_ => 0))?.default?.default //??????
		// systray2 不好用，Windows下图标会时不时消失，尝试过了，详见 7ef383c550663d9f1df051854df925e94e04025f

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
					},
					terminalWorks && {
						title: geti18n('fountConsole.tray.items.clearTerminalScreen.title'),
						tooltip: geti18n('fountConsole.tray.items.clearTerminalScreen.tooltip'),
						checked: false,
						enabled: true
					}
				].filter(Boolean)
			},
			debug: false,
			copyDir: false
		})

		systray.onClick(async action => {
			let action_id = action.seq_id
			if (!action_id--) open(hosturl)
			else if (!action_id--) open('https://github.com/steve02081504/fount')
			else if (!action_id--) open('https://discord.gg/GtR9Quzq2v')
			else if (!action_id--) restartor()
			else if (!action_id--) process.exit(0)
			else if (terminalWorks && !action_id--) {
				const terminalImage = await import('npm:terminal-image').catch(_ => 0)
				if (supportsAnsi) process.stdout.write('\x1Bc')
				else console.clear()
				await fetch('https://repository-images.githubusercontent.com/862251163/0ac90205-ae40-4fc6-af67-1e28d074c76b').
					then(res => res.arrayBuffer()).
					then(buffer => terminalImage.default.buffer(Buffer.from(buffer))).
					then(console.noBreadcrumb.log).
					catch(_ => 0)
			}
		})

		return systray
	}
	catch (err) {
		console.errorI18n('fountConsole.tray.createTrayFailed', { error: err })
	}
}
