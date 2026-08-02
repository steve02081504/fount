# Remove terminal keybindings (Shift+Enter / Ctrl+Backspace CSI-u patches)
Write-Host (Get-I18n -key 'remove.removing.terminalKeybindings')
Unregister-FountTerminalKeybindings
