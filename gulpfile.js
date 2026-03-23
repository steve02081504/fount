const { spawn } = require('node:child_process')

function runFount(done) {
	const isWindows = process.platform === 'win32'
	const script = isWindows ? 'run.bat' : 'run.sh'

	// Delegate to the existing launcher scripts in the repo root.
	const cmd = isWindows ? 'cmd.exe' : 'sh'
	const cmdArgs = isWindows ? ['/c', script] : [script]

	// Support FOUNT_ARGS env var for passing arguments, e.g.: FOUNT_ARGS=nop gulp
	const extraArgs = process.env.FOUNT_ARGS ? process.env.FOUNT_ARGS.split(' ') : []

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
