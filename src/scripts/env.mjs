import fs from 'node:fs'
/**
 * 一个布尔值，指示应用程序是否在 Docker 容器内运行。
 * @type {boolean}
 */
export const in_docker = (() => {
	if (process.platform !== 'linux') return false
	if (fs.existsSync('/.dockerenv')) return true
	if (fs.existsSync('/proc/1/cgroup')) {
		const cgroups = fs.readFileSync('/proc/1/cgroup', 'utf-8')
		return cgroups.includes('docker') || cgroups.includes('containerd')
	}
	return false
})()

/**
 * 一个布尔值，指示应用程序是否在 Termux 内运行。
 * @type {boolean}
 */
export const in_termux = (() => {
	if (process.platform !== 'linux') return false
	if (fs.existsSync('/data/data/com.termux')) return true
	return false
})()
