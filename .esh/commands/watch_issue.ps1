<#
.SYNOPSIS
	Poll a GitHub issue for new comments and append each new one to a log file.

.DESCRIPTION
	Uses `gh issue view --json comments` under a TLS-retry loop (see the repo-wide
	gh guidance) and writes every comment whose GraphQL node id it has not seen
	yet, oldest first, to -OutFile. Seen ids live in a sibling `.state` JSON file,
	so restarts do not replay history. Comment ids are opaque GraphQL node ids
	(e.g. `IC_kwDO...`), never integers — compare them as strings.

	Meant to run as a long-lived background job while an agent does other work;
	the agent then reads -OutFile to pick up the peer's replies.

.PARAMETER Issue
	Issue number.

.PARAMETER Repo
	owner/name. Defaults to steve02081504/fount.

.PARAMETER OutFile
	Log file for newly seen comments. Required.

.PARAMETER IntervalSeconds
	Sleep between polls. Defaults to 45.

.PARAMETER MaxPolls
	Stop after this many polls (0 = forever). Defaults to 0.

.EXAMPLE
	pwsh -File .esh/commands/watch_issue.ps1 -Issue 350 -OutFile "$env:TEMP/i350.log"
#>
[CmdletBinding()]
param(
	[Parameter(Mandatory)][int]$Issue,
	[string]$Repo = 'steve02081504/fount',
	[Parameter(Mandatory)][string]$OutFile,
	[int]$IntervalSeconds = 45,
	[int]$MaxPolls = 0
)

$ErrorActionPreference = 'Stop'
$stateFile = "$OutFile.state"
$seen = [System.Collections.Generic.HashSet[string]]::new()
if (Test-Path $stateFile) {
	try {
		$raw = Get-Content $stateFile -Raw
		if ($raw.Trim()) {
			$list = $raw | ConvertFrom-Json
			foreach ($id in $list) { [void]$seen.Add([string]$id) }
		}
	}
	catch { Write-Warning "unreadable state file ${stateFile}; starting from scratch" }
}

function Get-IssueJson {
	param([int]$Retries = 20)
	for ($attempt = 1; $attempt -le $Retries; $attempt++) {
		$raw = gh issue view $Issue --repo $Repo --json comments 2>$null | Out-String
		if ($LASTEXITCODE -eq 0 -and $raw.Trim()) {
			try { return $raw | ConvertFrom-Json }
			catch { Write-Warning "attempt ${attempt}: bad JSON" }
		}
		else { Write-Warning "attempt ${attempt}: gh failed" }
		Start-Sleep -Seconds 3
	}
	throw "could not read issue ${Issue} after ${Retries} attempts"
}

$poll = 0
while ($MaxPolls -eq 0 -or $poll -lt $MaxPolls) {
	$poll++
	try {
		$data = Get-IssueJson
		$fresh = @($data.comments | Sort-Object { [datetime]$_.createdAt } | Where-Object { -not $seen.Contains([string]$_.id) })
		foreach ($comment in $fresh) {
			$block = "=== comment $($comment.id) by $($comment.author.login) at $($comment.createdAt)`n$($comment.body)`n"
			Add-Content -Path $OutFile -Value $block -Encoding utf8
			[void]$seen.Add([string]$comment.id)
		}
		if ($fresh.Count) { ($seen | Sort-Object) | ConvertTo-Json -Compress | Set-Content -Path $stateFile -Encoding utf8 }
	}
	catch { Add-Content -Path $OutFile -Value "=== poll error: $_" -Encoding utf8 }
	if ($MaxPolls -eq 0 -or $poll -lt $MaxPolls) { Start-Sleep -Seconds $IntervalSeconds }
}
