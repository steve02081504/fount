function script:cmd_open {
	require passthrough win/refresh_path win/winget browser env
	handle_docker_passthrough @args
	if (-not $env:FOUNT_INSTALL_WAIT) {
		Test-Browser
		Open-BrowserUrl 'https://steve02081504.github.io/fount/wait?cold_bootting=true'
	}
	Invoke-FountFromCmd @args
	exit $LastExitCode
}
