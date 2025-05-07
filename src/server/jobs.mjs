import { getUserByUsername } from './auth.mjs'
import { getAllUserNames } from './auth.mjs'
import { save_config } from './server.mjs'
import { geti18n } from '../scripts/i18n.mjs'
import { loadPart, partsList } from './managers/index.mjs'

export function StartJob(username, parttype, partname, uid, data = null) {
	const jobs = getUserByUsername(username).jobs ??= {}
	jobs[parttype] ??= {}
	jobs[parttype][partname] ??= {}
	jobs[parttype][partname][uid] = data
	save_config()
}
export function EndJob(username, parttype, partname, uid) {
	delete getUserByUsername(username).jobs?.[parttype]?.[partname]?.[uid]
	save_config()
}
export async function ReStartJobs() {
	const users = getAllUserNames()
	for (const user of users) {
		const jobs = getUserByUsername(user).jobs ?? {}
		for (const parttype in jobs)
			for (const partname in jobs[parttype])
				for (const uid in jobs[parttype][partname]) {
					console.log(await geti18n('fountConsole.jobs.restartingJob', { username: user, parttype, partname, uid }))
					try {
						const part = await loadPart(user, parttype, partname)
						await part.interfaces.jobs.ReStartJob(user, jobs[parttype][partname][uid] ?? uid)
					} catch (err) {
						console.error(err)
					}
				}
	}
}
