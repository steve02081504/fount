import { gc } from '../scripts/gc.mjs'
import { console } from '../scripts/i18n.mjs'

import { getUserByUsername, getAllUserNames } from './auth.mjs'
import { events } from './events.mjs'
import { loadPart } from './managers/index.mjs'
import { save_config } from './server.mjs'

/**
 * 启动一个新作业并保存其状态。
 * @param {string} username - 拥有该作业的用户的用户名。
 * @param {string} parttype - 作业所属部件的类型。
 * @param {string} partname - 作业所属部件的名称。
 * @param {string} uid - 作业的唯一标识符。
 * @param {any} [data=null] - 与作业关联的可选数据。
 * @returns {void}
 */
export function StartJob(username, parttype, partname, uid, data = null) {
	const jobs = getUserByUsername(username).jobs ??= {}
	jobs[parttype] ??= {}
	jobs[parttype][partname] ??= {}
	jobs[parttype][partname][uid] = data
	try {
		save_config()
	}
	catch (err) {
		console.error(err)
		EndJob(username, parttype, partname, uid)
	}
}
/**
 * 结束一个作业并移除其状态。
 * @param {string} username - 拥有该作业的用户的用户名。
 * @param {string} parttype - 作业所属部件的类型。
 * @param {string} partname - 作业所属部件的名称。
 * @param {string} uid - 作业的唯一标识符。
 * @returns {void}
 */
export function EndJob(username, parttype, partname, uid) {
	const jobs = getUserByUsername(username).jobs ??= {}
	if (jobs?.[parttype]?.[partname]?.[uid] !== undefined) {
		delete jobs[parttype][partname][uid]
		if (!Object.keys(jobs[parttype][partname]).length) {
			delete jobs[parttype][partname]
			if (!Object.keys(jobs[parttype]).length)
				delete jobs[parttype]
		}
		save_config()
	}
	else {
		console.warn('Job not found:', { username, parttype, partname, uid })
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
	for (const parttype in jobs)
		for (const partname in jobs[parttype])
			for (const uid in jobs[parttype][partname])
				promises.push((async () => {
					console.logI18n('fountConsole.jobs.restartingJob', { username, parttype, partname, uid })
					const part = await loadPart(username, parttype, partname)
					await part.interfaces.jobs.ReStartJob(username, jobs[parttype][partname][uid] ?? uid)
				})().catch(console.error))
	await Promise.all(promises)
	return promises.length
}
/**
 * 重新启动所有用户的所有作业。
 * @returns {Promise<void>}
 */
export async function ReStartJobs() {
	const count = (await Promise.all(getAllUserNames().map(startJobsOfUser))).reduce((a, b) => a + b, 0)
	if (count) gc()
}

events.on('AfterUserRenamed', async ({ oldUsername, newUsername }) => {
	await startJobsOfUser(newUsername)
})
