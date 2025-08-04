import { __dirname } from '../server/base.mjs'

export function runWorker(name) {
	return new Worker(new URL(`./${name}.mjs`, import.meta.url), { type: 'module' })
}
export function runSimpleWorker(name) {
	const worker = runWorker(name)
	return new Promise((resolve, reject) => {
		worker.onmessage = (event) => {
			worker.terminate()
			switch (event.data.type) {
				case 'resolve': {
					return resolve(event.data.data)
				}
				case 'reject': {
					return reject(event.data.data)
				}
			}
		}
		worker.onerror = (error) => {
			worker.terminate()
			reject(error)
		}
		worker.postMessage({ type: 'init', __dirname })
	})
}
