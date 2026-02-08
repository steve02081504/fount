import { gc } from '../scripts/gc.mjs'
import { console } from '../scripts/i18n.mjs'

import { getUserByUsername, getAllUserNames } from './auth.mjs'
import { events } from './events.mjs'
import {
	loadPart,
	enableLoadPartRecording,
	disableLoadPartRecording,
	getLoadPartCallRecords,
} from './parts_loader.mjs'
import { config, save_config } from './server.mjs'

/**
 * 启动一个新作业并保存其状态。
 * @param {string} username - 拥有该作业的用户的用户名。
 * @param {string} partpath - 作业所属部件的路径。
 * @param {string} uid - 作业的唯一标识符。
 * @param {any} [data=null] - 与作业关联的可选数据。
 * @returns {void}
 */
export function StartJob(username, partpath, uid, data = null) {
	const jobs = getUserByUsername(username).jobs ??= {}
	jobs[partpath] ??= {}
	jobs[partpath][uid] = data
	try {
		save_config()
	}
	catch (err) {
		console.error(err)
		EndJob(username, partpath, uid)
	}
}
/**
 * 结束一个作业并移除其状态。
 * @param {string} username - 拥有该作业的用户的用户名。
 * @param {string} partpath - 作业所属部件的路径。
 * @param {string} uid - 作业的唯一标识符。
 * @returns {void}
 */
export function EndJob(username, partpath, uid) {
	const jobs = getUserByUsername(username).jobs ??= {}
	if (jobs?.[partpath]?.[uid] !== undefined) {
		delete jobs[partpath][uid]
		if (!Object.keys(jobs[partpath]).length)
			delete jobs[partpath]

		save_config()
	}
	else {
		console.warn('Job not found:', { username, partpath, uid })
		throw new Error('Job not found')
	}
}
/**
 * 重新启动特定用户的所有作业。
 * @param {string} username - 应重新启动其作业的用户的用户名。
 * @returns {Promise<number>} 一个解析为已重新启动作业数量的承诺。
 */
async function startJobsOfUser(username) {
	const jobs = getUserByUsername(username).jobs ?? {}
	const promises = []
	for (const partpath in jobs)
		for (const uid in jobs[partpath])
			promises.push((async () => {
				console.logI18n('fountConsole.jobs.restartingJob', { username, partpath, uid })
				const part = await loadPart(username, partpath)
				await part.interfaces.jobs.ReStartJob(username, jobs[partpath][uid] ?? uid)
			})().catch(console.error))
	await Promise.all(promises)
	return promises.length
}

/**
 * 从config.prelaunch.jobparts预加载所有记录的部件。
 * @returns {Promise<void>}
 */
function preloadPartsFromConfig() {
	const prelaunchParts = config.prelaunch?.jobparts || []
	if (!prelaunchParts.length) return

	console.logI18n('fountConsole.jobs.preloadingParts', { count: prelaunchParts.length })
	prelaunchParts.map(async (record) => {
		const [username, partpath] = record.split(':')
		if (!username || !partpath) return
		try {
			await loadPart(username, partpath, { username })
		} catch (error) {
			console.error(`Failed to preload part ${partpath} for user ${username}:`, error)
		}
	})
}
/**
 * 暂停指定用户的所有作业（停止运行中的实例，但保留 config 中的作业数据以便恢复）。
 * @param {string} username - 用户名。
 * @returns {Promise<number>} 解析为已暂停作业数量的 Promise。
 */
async function pauseJobsOfUser(username) {
	const jobs = getUserByUsername(username).jobs ?? {}
	const promises = []
	for (const partpath in jobs)
		for (const uid in jobs[partpath])
			promises.push((async () => {
				console.logI18n('fountConsole.jobs.pausingJob', { username, partpath, uid })
				const part = await loadPart(username, partpath)
				await part.interfaces.jobs.PauseJob(username, uid)
			})().catch(console.error))
	await Promise.all(promises)
	return promises.length
}

/**
 * 暂停所有用户的所有作业。
 * @returns {Promise<void>}
 */
export async function PauseAllJobs() {
	await Promise.all(getAllUserNames().map(pauseJobsOfUser))
}

/**
 * 重新启动所有用户的所有作业。
 * @returns {Promise<void>}
 */
export async function ReStartJobs() {
	preloadPartsFromConfig()
	enableLoadPartRecording()
	try {
		const count = (await Promise.all(getAllUserNames().map(startJobsOfUser))).reduce((a, b) => a + b, 0)
		if (count) gc()
	}
	finally {
		(config.prelaunch ??= {}).jobparts = getLoadPartCallRecords()
		disableLoadPartRecording()
		save_config()
	}
}

events.on('AfterUserRenamed', async ({ oldUsername, newUsername }) => {
	await startJobsOfUser(newUsername)
})
