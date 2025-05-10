import { applyTheme } from '../../scripts/theme.mjs'
applyTheme()

import { initTranslations, geti18n } from '../../scripts/i18n.mjs'
import { setTerminal } from '../../scripts/terminal.mjs'

const terminal = setTerminal(document.getElementById('terminal'))

await initTranslations('terminal_assistant')

terminal.writeln(geti18n('terminal_assistant.initialMessage'))
terminal.writeln(`\x1b]8;;https://github.com/steve02081504/fount-pwsh\x07${geti18n('terminal_assistant.initialMessageLink')}\x1b]8;;\x07`)
