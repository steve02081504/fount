export function with_timeout(ms, promise) {
	return new Promise((resolve, reject) => {
		promise.then(resolve).catch(reject)
		setTimeout(() => reject(new Error('timeout')), ms)
	})
}
