import fs from 'node:fs'
export const in_docker = (() => {
	if (process.platform !== 'linux') return false
	if (fs.existsSync('/.dockerenv')) return true
	if (fs.existsSync('/proc/1/cgroup')) {
		const cgroups = fs.readFileSync('/proc/1/cgroup', 'utf-8')
		return cgroups.includes('docker') || cgroups.includes('containerd')
	}
	return false
})()

export const in_termux = (() => {
	if (process.platform !== 'linux') return false
	if (fs.existsSync('/data/data/com.termux')) return true
	return false
})()
