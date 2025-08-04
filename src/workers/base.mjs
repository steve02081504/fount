export let __dirname
let main
export function setMain(fn) { main = fn }
self.onmessage = async (e) => {
	switch (e.data.type) {
		case 'init': {
			__dirname = e.data.__dirname
			const result = await main()
			self.postMessage({
				type: 'resolve',
				data: result,
			})
			break
		}
	}
}
