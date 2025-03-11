import ansiEscapes from 'ansi-escapes'

let loggedFreshLine = ''
const myConsole = {
	log: (...args) => {
		loggedFreshLine = false
		console.log(...args)
	},
	dir: (...args) => {
		loggedFreshLine = false
		console.dir(...args)
	},
	error: (...args) => {
		loggedFreshLine = false
		console.error(...args)
	},
	freshLine: (id, ...args) => {
		let logger = console.log
		if (loggedFreshLine == id) logger = (...args) => console.log(ansiEscapes.cursorUp(1) + ansiEscapes.eraseLine + args[0], ...args.slice(1))
		loggedFreshLine = id
		logger(...args)
	}
}

export { myConsole as console }
