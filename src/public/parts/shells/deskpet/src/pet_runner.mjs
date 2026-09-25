import { on_shutdown } from 'npm:on-shutdown'

import { console } from '../../../../../scripts/i18n/bare.mjs'
import { generateApiKey, revokeApiKey } from '../../../../../server/auth/index.mjs'
import { StartJob, EndJob } from '../../../../../server/jobs.mjs'
import { getPartList, loadPart } from '../../../../../server/parts_loader.mjs'
import { hosturl } from '../../../../../server/server.mjs'
import { sendEventToAll } from '../../../../../server/web_server/event_dispatcher.mjs'
import { unlockAchievement } from '../../achievements/src/api.mjs' // Import unlockAchievement

const runningPets = {} // { [username]: { [charname]: { webview, apiKey, closeTimer } } }

const WINDOW_CLOSE_POLL_MS = 1000

/**
 * 列出用户可用的宠物角色。
 * @param {string} username - 用户名。
 * @returns {Array<string>} - 角色名称列表。
 */
export function getPetList(username) {
	return getPartList(username, 'chars')
}

/**
 * 获取正在运行的宠物。
 * @param {string} username - 用户名。
 * @returns {Array<string>} - 正在运行的宠物列表。
 */
export function getRunningPets(username) {
	if (!runningPets[username]) return []
	return Object.keys(runningPets[username])
}

/**
 * 清理窗口关闭轮询器。
 * @param {{ closeTimer?: number }} [petInfo] - 宠物运行信息。
 * @returns {void}
 */
function clearCloseWatcher(petInfo) {
	if (!petInfo?.closeTimer) return
	clearInterval(petInfo.closeTimer)
	petInfo.closeTimer = undefined
}

/**
 * 轮询 WebUI 窗口连接状态，窗口关闭后回收该宠物并吊销其临时 API key。
 * @param {string} username - 用户名。
 * @param {string} charname - 角色名称。
 * @param {import('jsr:@webui/deno-webui').WebUI} webview - 宠物窗口。
 * @returns {number} 轮询器句柄。
 */
function watchWindowClose(username, charname, webview) {
	const timer = setInterval(() => {
		if (webview.isShown) return
		clearInterval(timer)
		stopPet(username, charname).catch(console.error)
	}, WINDOW_CLOSE_POLL_MS)
	return timer
}

/**
 * 运行宠物。
 * @param {string} username - 用户名。
 * @param {string} charname - 角色名称。
 * @returns {Promise<void>}
 */
export async function runPet(username, charname) {
	if (runningPets[username]?.[charname]) return

	StartJob(username, 'shells/deskpet', charname)

	try {
		const char = await loadPart(username, 'chars/' + charname)
		char.interfaces ??= {}
		if (!char.interfaces.deskpet) {
			const { createDefaultDeskpetInterface } = await import('./default_interface/main.mjs')
			char.interfaces.deskpet = await createDefaultDeskpetInterface(char, username, charname)
		}
		const petConfig = await char.interfaces.deskpet.GetPetConfig()

		if (!petConfig || !petConfig.url)
			throw new Error(`Character ${charname} does not provide a valid pet URL.`)


		const { apiKey } = await generateApiKey(username, `DeskPet-${charname}-temp-key`)
		const intermediatePageUrl = `${hosturl}/parts/shells:deskpet/set_cookie_and_redirect.html`
		const finalUrl = `${intermediatePageUrl}?apikey=${encodeURIComponent(apiKey)}&redirect=${encodeURIComponent(petConfig.url)}`

		const { WebUI } = await import('jsr:@webui/deno-webui')

		const myWindow = new WebUI()

		myWindow.bind('minimize', () => {
			myWindow.minimize()
		})
		myWindow.bind('close_win', () => {
			myWindow.close()
		})

		myWindow.setSize(petConfig.windowOptions?.width ?? 400, petConfig.windowOptions?.height ?? 400)
		myWindow.setFrameless(petConfig.windowOptions?.frameless ?? true)
		myWindow.setTransparent(petConfig.windowOptions?.transparent ?? true)
		myWindow.setResizable(false)

		runningPets[username] ??= {}
		const petInfo = runningPets[username][charname] = { webview: myWindow, apiKey }
		sendEventToAll('deskpet-list-updated')
		unlockAchievement(username, 'shells/deskpet', 'start_deskpet') // Trigger achievement here

		// 注意：show() 在窗口成功连接到桥接后即 resolve，并非等到窗口关闭。
		// 因此不能在 resolve 后立刻回收 key，而应保留窗口并轮询其关闭。
		// 不 await，避免 start 请求被窗口启动（最多 30s）阻塞。
		myWindow.show(finalUrl)
			.then(() => {
				petInfo.closeTimer = watchWindowClose(username, charname, myWindow)
			})
			.catch(async error => {
				console.error(`[DeskPet] Failed to show pet window for ${charname}:`, error)
				await stopPet(username, charname)
			})
	} catch (error) {
		console.error(`[DeskPet] Failed to start pet for ${charname}:`, error)
		if (runningPets[username]?.[charname])
			await stopPet(username, charname)
		else
			EndJob(username, 'shells/deskpet', charname) // End job on early failure
	}
}

/**
 * 停止宠物。
 * @param {string} username - 用户名。
 * @param {string} charname - 角色名称。
 * @returns {Promise<void>}
 */
export async function stopPet(username, charname) {
	const petInfo = runningPets[username]?.[charname]
	if (!petInfo) {
		console.log(`[DeskPet] No running pet found for ${charname} by user ${username} to stop.`)
		return
	}

	clearCloseWatcher(petInfo)
	delete runningPets[username][charname]
	if (!Object.keys(runningPets[username]).length)
		delete runningPets[username]

	try {
		petInfo.webview.destroy()
	}
	catch (error) {
		console.error(`[DeskPet] Failed to destroy pet window for ${charname}:`, error)
	}

	// Revoke the API key
	await revokeApiKey(petInfo.apiKey)

	EndJob(username, 'shells/deskpet', charname)
	sendEventToAll('deskpet-list-updated')
}

/**
 * 暂停宠物（停止运行但不从 config 中移除，以便 PauseAllJobs 后可通过 ReStartJobs 恢复）。
 * @param {string} username - 用户名。
 * @param {string} charname - 角色名称。
 * @returns {Promise<void>}
 */
export async function pausePet(username, charname) {
	const petInfo = runningPets[username]?.[charname]
	if (!petInfo) return

	clearCloseWatcher(petInfo)
	delete runningPets[username][charname]
	if (!Object.keys(runningPets[username]).length)
		delete runningPets[username]

	try {
		petInfo.webview.destroy()
	}
	catch (error) {
		console.error(`[DeskPet] Failed to destroy pet window for ${charname}:`, error)
	}
	await revokeApiKey(petInfo.apiKey)
	sendEventToAll('deskpet-list-updated')
}
on_shutdown(async () => {
	for (const username of Object.keys(runningPets))
		for (const charname of Object.keys(runningPets[username] ?? {}))
			await pausePet(username, charname).catch(console.error)
})
