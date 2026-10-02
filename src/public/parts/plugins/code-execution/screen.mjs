/**
 * 在执行机器上截取指定显示器，不启动任何操作系统进程。
 * @param {number} monitorIndex Zero-based monitor index.
 * @returns {Promise<string>} PNG screenshot encoded as base64.
 */
export async function captureMonitor(monitorIndex = 0) {
	const process = (await import('node:process')).default
	if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
		throw new Error('Cannot capture screen: no DISPLAY or WAYLAND_DISPLAY is available on the target machine.')
	const { Monitor } = await import('npm:node-screenshots')
	const monitors = Monitor.all()
	if (!monitors.length) throw new Error('Cannot capture screen: the target machine has no available monitors.')
	const monitor = monitors[monitorIndex]
	if (!monitor) throw new Error(`Cannot capture screen: monitor ${monitorIndex} is unavailable (${monitors.length} monitors).`)
	const image = await monitor.captureImage()
	const bytes = await image.toPng()
	return (await import('node:buffer')).Buffer.from(bytes).toString('base64')
}

/** 供子节点执行的可序列化截屏源码（远程机器自行解析原生依赖）。 */
export const captureMonitorSource = `(${captureMonitor.toString()})`
