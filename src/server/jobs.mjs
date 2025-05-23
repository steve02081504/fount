import { getUserByUsername } from './auth.mjs'
import { getAllUserNames } from './auth.mjs'
import { save_config } from './server.mjs'
import { loadPart } from './managers/index.mjs'
import { events } from './events.mjs'
import { geti18n } from '../scripts/i18n.mjs'

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
async function startJobsOfUser(username) {
	const jobs = getUserByUsername(username).jobs ?? {}
	for (const parttype in jobs)
		for (const partname in jobs[parttype])
			for (const uid in jobs[parttype][partname])
				try {
					console.log(await geti18n('fountConsole.jobs.restartingJob', { username, parttype, partname, uid }))
					const part = await loadPart(username, parttype, partname)
					await part.interfaces.jobs.ReStartJob(username, jobs[parttype][partname][uid] ?? uid)
				} catch (err) {
					console.error(err)
				}
}
export async function ReStartJobs() {
	await Promise.all(getAllUserNames().map(startJobsOfUser))
}

events.on('AfterUserRenamed', async ({ oldUsername, newUsername }) => {
	await startJobsOfUser(newUsername)
})
