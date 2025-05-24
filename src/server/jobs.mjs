import { getUserByUsername } from './auth.mjs'
import { getAllUserNames } from './auth.mjs'
import { save_config } from './server.mjs'
import { loadPart } from './managers/index.mjs'
import { events } from './events.mjs'

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
					const part = await loadPart(username, parttype, partname)
					await part.interfaces.jobs.StartJob(username, jobs[parttype][partname][uid] ?? uid)
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
