$script:TaskbarProgressEnabled = $Host.UI.SupportsVirtualTerminal -and -not [System.Console]::IsOutputRedirected
$script:TaskbarProgressEsc = [char]27
$script:TaskbarProgressBel = [char]7
function Write-TaskbarProgress([int]$Percent) {
	if (-not $script:TaskbarProgressEnabled) { return }
	if ($PSBoundParameters.ContainsKey('Percent')) {
		$p = [Math]::Max(0, [Math]::Min(100, $Percent))
		Write-Host -NoNewline ($script:TaskbarProgressEsc + "]9;4;1;$p" + $script:TaskbarProgressBel)
	}
	else {
		Write-Host -NoNewline ($script:TaskbarProgressEsc + "]9;4;3" + $script:TaskbarProgressBel)
	}
}
function Write-TaskbarProgressClear {
	if ($script:TaskbarProgressEnabled) {
		Write-Host -NoNewline ($script:TaskbarProgressEsc + "]9;4;0" + $script:TaskbarProgressBel)
	}
}
function Write-TaskbarProgressError {
	if ($script:TaskbarProgressEnabled) {
		Write-Host -NoNewline ($script:TaskbarProgressEsc + "]9;4;2;100" + $script:TaskbarProgressBel)
	}
}
function Set-Title($Title) {
	$Host.UI.RawUI.WindowTitle = $Title
}
function Get-Title {
	$Host.UI.RawUI.WindowTitle
}

function Register-FountTerminalTeardown {
	if ($script:FountTerminalTeardownRegistered) { return }
	$script:FountTerminalTeardownTitle = Get-Title
	$script:FountTerminalTeardownRegistered = $true
}

function Complete-FountTerminalTeardown {
	Write-TaskbarProgressClear
	if ($script:FountTerminalTeardownTitle) {
		Set-Title $script:FountTerminalTeardownTitle
	}
}
