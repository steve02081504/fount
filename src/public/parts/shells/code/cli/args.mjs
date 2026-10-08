/**
 * code CLI 的帮助文本。
 */
export const CLI_HELP = `fount run code [--cli | --print] [options]

  --cli                       Open the interactive terminal (print if redirected)
  --print                     Print one committed run to stdout
  --output-format ndjson|text  Force print mode and select stdout format
  --session, -s ID            Open or create ID in the selected workspace
  --prompt, -p TEXT           Send TEXT
  --prompt-file PATH          Read prompt from PATH (- means stdin)
  --workspace, -w PATH        Use PATH relative to the calling directory
  --workspace-id ID           Use a saved local or remote workspace
  --char NAME                 Select a character
  --model, --ai-source NAME   Select an AI source (char = character default)
  --profile NAME              Select a profile
  --attach                    Observe the current run; requires --session
  --tui-mode fullscreen|regular
  --help                      Show this help

Session IDs are scoped to one workspace. Use /sessions all to locate another workspace.`

/**
 * 判断 path CLI 是否应调用 code CLI。
 * @param {string[]} args - Arguments after `fount run code`.
 * @returns {boolean} 是否运行 CLI 而非打开网页。
 */
export function shouldUseCodeCli(args = []) {
	return args.some(argument => ['--cli', '--print', '--help', '--output-format'].includes(String(argument).split('=')[0]))
}

/**
 * 根据 stdout 是否重定向选择默认打印格式。
 * @param {string} [requested] - Explicit format.
 * @param {boolean} [stdoutIsTTY] - Whether stdout is a terminal.
 * @returns {'ndjson'|'text'} 输出格式。
 */
export function resolveCodeOutputFormat(requested, stdoutIsTTY) {
	return requested || (stdoutIsTTY ? 'text' : 'ndjson')
}

const valueOptions = new Map([
	['--session', 'session'], ['-s', 'session'], ['--prompt', 'prompt'], ['-p', 'prompt'],
	['--prompt-file', 'promptFile'], ['--workspace', 'workspace'], ['-w', 'workspace'],
	['--workspace-id', 'workspaceId'], ['--char', 'char'], ['--model', 'model'],
	['--ai-source', 'model'], ['--profile', 'profile'], ['--tui-mode', 'tuiMode'], ['--output-format', 'outputFormat'],
])

/**
 * 解析 code CLI 参数，并校验互斥关系与取值范围。
 * @param {string[]} args - `fount run code` 之后、partpath 之外的原始参数。
 * @returns {{cli: boolean, print: boolean, help: boolean, attach: boolean, tuiMode: string, session?: string, prompt?: string, promptFile?: string, workspace?: string, workspaceId?: string, char?: string, model?: string, profile?: string, outputFormat?: string}} 归一化后的选项；非法组合直接抛出错误。
 */
export function parseCodeArgs(args = []) {
	const parsed = { cli: false, print: false, help: false, attach: false, tuiMode: 'fullscreen' }
	for (let index = 0; index < args.length; index++) {
		const [name, ...tail] = String(args[index]).split('=')
		if (['--cli', '--print', '--help', '--attach'].includes(name)) {
			if (tail.length) throw new Error(`${name} takes no value`)
			parsed[{ '--cli': 'cli', '--print': 'print', '--help': 'help', '--attach': 'attach' }[name]] = true
			continue
		}
		const key = valueOptions.get(name)
		if (!key) throw new Error(`unknown option: ${name}`)
		const value = tail.length ? tail.join('=') : args[++index]
		if (value == null || value === '' || String(value).startsWith('--')) throw new Error(`${name} requires a value`)
		parsed[key] = String(value)
	}
	if (parsed.workspace && parsed.workspaceId) throw new Error('--workspace and --workspace-id cannot be combined')
	if (parsed.prompt && parsed.promptFile) throw new Error('--prompt and --prompt-file cannot be combined')
	if (parsed.attach && (!parsed.session || parsed.prompt || parsed.promptFile)) throw new Error('--attach requires --session and forbids a prompt')
	if (parsed.session && !/^[\w-]{1,64}$/.test(parsed.session)) throw new Error('invalid session ID')
	if (parsed.outputFormat && !['ndjson', 'text'].includes(parsed.outputFormat)) throw new Error('invalid --output-format')
	if (!['fullscreen', 'regular'].includes(parsed.tuiMode)) throw new Error('invalid --tui-mode')
	return parsed
}
