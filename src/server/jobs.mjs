import { loadShell } from './managers/shell_manager.mjs'
import { getUserByUsername } from './auth.mjs'
import { getAllUserNames } from './auth.mjs'
import { save_config } from './server.mjs'
import { geti18n } from '../scripts/i18n.mjs'

export function StartJob(username, shellname, uid, data = null) {
	const jobs = getUserByUsername(username).jobs ??= {}
	jobs[shellname] ??= {}
	jobs[shellname][uid] = data
	save_config()
}
export function EndJob(username, shellname, uid) {
	delete getUserByUsername(username).jobs[shellname][uid]
	save_config()
}
export async function ReStartJobs() {
	const users = getAllUserNames()
	for (const user of users) {
		const jobs = getUserByUsername(user).jobs ??= {}
		for (const shellname in jobs)
			for (const uid in jobs[shellname]) {
				console.log(await geti18n('fountConsole.jobs.restartingJob', { username: user, shellname, uid }))
				const shell = await loadShell(user, shellname)
				await shell.ReStartJob(user, jobs[shellname][uid] ?? uid, uid)
			}
	}
}
