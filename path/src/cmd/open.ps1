function script:Invoke-FountCmdOpen {
	RequireMany passthrough win/refresh_path win/winget browser
	if (Test-Path -Path "$FOUNT_DIR/data/config.json") {
		Invoke-DockerPassthrough -CurrentArgs $args
		Test-Browser
		Start-Process 'https://steve02081504.github.io/fount/wait?cold_bootting=true'
		$runargs = @($args | Select-Object -Skip 1)
		fount.ps1 @runargs
		exit $LastExitCode
	}

	$statusServerScriptBlock = {
		$listener = [System.Net.HttpListener]::new()
		$listener.Prefixes.Add("http://localhost:8930/")
		$listener.Start()

		try {
			while ($true) {
				$response = $listener.GetContext().Response
				$response.AddHeader("Access-Control-Allow-Origin", "*")
				$buffer = [System.Text.Encoding]::UTF8.GetBytes('{"message":"pong"}')
				$response.ContentType = "application/json"
				$response.ContentLength64 = $buffer.Length
				$response.OutputStream.Write($buffer, 0, $buffer.Length)
				$response.Close()
			}
		}
		finally {
			$listener.Stop()
			$listener.Close()
		}
	}
	$statusServerJob = Start-Job -ScriptBlock $statusServerScriptBlock
	try {
		$runargs = @($args | Select-Object -Skip 1)
		Test-Browser
		Start-Process 'https://steve02081504.github.io/fount/wait/install'
		fount.ps1 @runargs
	}
	finally {
		Stop-Job $statusServerJob
		Remove-Job $statusServerJob
	}
	exit $LastExitCode
}
