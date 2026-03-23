const { spawn } = require('node:child_process')

function runFount(done) {
	const isWindows = process.platform === 'win32'
	const script = isWindows ? 'run.bat' : 'run.sh'

	// Delegate to the existing launcher scripts in the repo root.
	const cmd = isWindows ? 'cmd.exe' : 'sh'
	const cmdArgs = isWindows ? ['/c', script] : [script]

	// Support `gulp -- nop` style argument forwarding.
	const argv = process.argv.slice(2)
	const dashIndex = argv.indexOf('--')
	const extraArgs = dashIndex >= 0 ? argv.slice(dashIndex + 1) : argv

	const child = spawn(cmd, [...cmdArgs, ...extraArgs], {
		cwd: process.cwd(),
		stdio: 'inherit',
	})

	child.on('error', (err) => done(err))
	child.on('close', (code) => {
		// gulp convention: pass error first, then result code.
		done(code ? new Error(`fount exited with code ${code}`) : null)
	})
}

exports.run = runFount
exports.default = runFount
