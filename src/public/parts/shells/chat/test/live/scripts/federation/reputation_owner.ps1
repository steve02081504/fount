# Federation reputation slash fanout and owner-succession cross-node.
$ErrorActionPreference = 'Stop'
. (Join-Path $env:FOUNT_TEST_REPO_ROOT 'src/scripts/test/live/federation/common.ps1')

$groupId = $null; $channelId = $null

Write-Host "=== Setup: open group + join ===" -ForegroundColor Cyan
$setup = Initialize-OpenGroupJoin 'FedRepOwner' 'rep-owner-seed'
$groupId = $setup.groupId; $channelId = $setup.channelId

$script:resolvedTarget = $null
$found = Wait-FedConverged $FedA $groupId {
	$state = Api $FedA GET "/groups/$groupId/state"
	if ($state.status -ne 200) { return $false }
	$candidate = @($state.json.state.members | Where-Object {
		$_.status -eq 'active' -and $_.pubKeyHash -and ($_.roles -notcontains 'founder')
	})[0]
	if ($candidate) {
		$script:resolvedTarget = [string]$candidate.pubKeyHash
		return $true
	}
	$false
} 120 3 4000
if (-not $found -or -not $script:resolvedTarget) {
	throw 'B member pubkey not resolved after join — federation setup incomplete'
}
$targetPubKeyHash = $script:resolvedTarget

$ownerSuccessionTarget = $targetPubKeyHash

Write-Host "`n=== 1. Reputation slash fanout ===" -ForegroundColor Cyan
Test-Case 'A verified reputation/slash on B' {
	$tips = Api $FedA GET "/groups/$groupId/dag/tips"
	$tip = @($tips.json.tips)[0]
	$response = Api $FedA POST "/groups/$groupId/reputation/slash" @{
		targetPubKeyHash = $targetPubKeyHash
		claim = 0.05
		verified = $true
		proof = @{ eventId = $tip }
	}
	if ($response.status -ne 200) { throw "slash $($response.status): $($response.raw)" }
	Invoke-FedCatchupSync $FedA $groupId 12000
	$events = Api $FedA GET "/groups/$groupId/events?limit=20"
	@($events.json.events | Where-Object { $_.type -eq 'reputation_slash' }).Count -ge 1
}
Test-Case 'B GET reputation reflects slash (fanout/catchup)' {
	$ok = Wait-FedConverged $FedB $groupId {
		$events = Api $FedB GET "/groups/$groupId/events?limit=40"
		if ($events.status -ne 200) { return $false }
		@($events.json.events | Where-Object {
			$_.type -eq 'reputation_slash' -and $_.content.targetPubKeyHash -eq $targetPubKeyHash
		}).Count -ge 1
	} 300 4 12000
	if (-not $ok) { throw 'B must receive reputation_slash via federation catchup (no manual A-side inject)' }
	$true
}

Write-Host "`n=== 2. Owner-succession cross-node ===" -ForegroundColor Cyan
Test-Case 'A POST owner-succession → B' {
	$state = Api $FedA GET "/groups/$groupId/state"
	if ($state.status -ne 200) { throw "state $($state.status)" }
	$activeOnA = @($state.json.state.members | Where-Object { $_.pubKeyHash -eq $ownerSuccessionTarget }).Count -ge 1
	if (-not $activeOnA) { throw "proposed owner not active on A" }
	$ballotId = "fed-rep-owner-os-$([guid]::NewGuid().ToString('N').Substring(0, 12))"
	$response = Api $FedA POST "/groups/$groupId/owner-succession" @{
		proposedOwnerPubKeyHash = $ownerSuccessionTarget
		ballotId = $ballotId
	}
	if ($response.status -ne 200) { throw "succession $($response.status): $($response.raw)" }
	Api $FedA POST "/groups/$groupId/dag/merge-tips" @{} | Out-Null
	$response.json.newOwnerPubKeyHash -eq $ownerSuccessionTarget
}
Test-Case 'B state sees new owner (federation)' {
	$hasTransferredFounder = {
		param($state)
		if ($state.groupMeta.ownerPubKeyHash -eq $ownerSuccessionTarget) { return $true }
		if ($state.delegatedOwnerPubKeyHash -eq $ownerSuccessionTarget) { return $true }
		$rows = @($state.members)
		$target = @($rows | Where-Object { $_.pubKeyHash -eq $ownerSuccessionTarget })[0]
		if (-not $target) { return $false }
		$targetIsFounder = @($target.roles) -contains 'founder'
		$otherFounders = @($rows | Where-Object {
			$_.status -eq 'active' -and $_.pubKeyHash -ne $ownerSuccessionTarget -and (@($_.roles) -contains 'founder')
		}).Count
		$targetIsFounder -and $otherFounders -eq 0
	}
	$ok = Wait-FedConverged $FedB $groupId {
		$stateResponse = Api $FedB GET "/groups/$groupId/state"
		if ($stateResponse.status -ne 200) { return $false }
		& $hasTransferredFounder $stateResponse.json.state
	} 120 4 8000
	if (-not $ok) { throw 'B must see owner succession via federation catchup (no manual A-side inject)' }
	[bool]$ok
}

Clear-FedGroup $groupId
Write-FedSummary 'FED-REP-OWNER' $groupId
Complete-LiveScript
