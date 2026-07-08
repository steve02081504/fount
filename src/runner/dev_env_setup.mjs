import fs from 'node:fs'
import { where_command, exec } from "npm:@steve02081504/exec"
import { console } from "npm:@steve02081504/virtual-console"

console.log(...eval(fs.readFileSync(new URL('../../imgs/icon.js', import.meta.url), 'utf8')))
let all_setted = true
for (const command of [
	{
		command: 'git',
		description: 'git is used to commit and push changes',
		get_description: 'install from https://git-scm.com/downloads',
	},
	{
		command: 'deno',
		description: 'runs default js files',
		get_description: 'run fount and itll be auto-installed',
	},
	{
		command: "gh",
		description: 'github cli, used to create issues and PRs automatically',
		get_description: 'install from https://github.com/cli/cli/releases',
		next: [
			async () => {
				const { stdall } = await exec("gh auth status")
				if (stdall.includes('Logged in')) console.log('  ✔ gh logged in')
				else {
					console.log('  ✘ gh not logged in')
					console.error('   run `gh auth login` to login')
					return true
				}
			}
		]
	},
	{
		command: 'fount',
		description: 'we use fount test to run tests',
		get_description: 'run fount and itll be auto-added to path',
	},
]) {
	console.freshLine(command.command, `Checking ${command.command}...`)
	if (!await where_command(command.command)) {
		console.freshLine(command.command, `✘ ${command.command} is not in path`)
		console.error(command.get_description)
		all_setted = false
	}
	else {
		console.freshLine(command.command, `✔ ${command.command} is in path`)
		for (const next of command.next || []) if (await next()) all_setted = false
	}
}
if (all_setted) console.log('🥳 All commands are usable, your dev environment is ready!')
else console.log('❌ Some commands are not correctly configured, please check the output above')
if (!fs.existsSync('./data/test/report.md')) {
	console.log('🔥 Creating test cache...')
	await exec('fount test --continue --no-parallel', {
		on_stdout: (data) => process.stdout.write(data),
		on_stderr: (data) => process.stderr.write(data)
	})
	console.log('🥳 Test cache created successfully')
}
