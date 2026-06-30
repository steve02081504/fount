# Federation reputation slash fanout and owner-succession cross-node.
$ErrorActionPreference = 'Stop'
. (Join-Path $env:FOUNT_TEST_REPO_ROOT 'src/scripts/test/live/federation/common.ps1')

$groupId = $null; $channelId = $null; $targetPubKeyHash = $null; $ownerSuccessionTarget = $null

Write-Host "=== Setup: open group + join ===" -ForegroundColor Cyan
$setup = Initialize-OpenGroupJoin 'FedRepOwner' 'rep-owner-seed'
$groupId = $setup.groupId; $channelId = $setup.channelId

$resolvedTarget = PollUntil 120 3 {
	Api $FedA POST "/groups/$groupId/federation/catchup" @{ waitMs = 4000 } | Out-Null
	$state = Api $FedA GET "/groups/$groupId/state"
	if ($state.status -ne 200) { return $null }
	$candidate = @($state.json.state.members | Where-Object {
		$_.status -eq 'active' -and $_.pubKeyHash -and ($_.roles -notcontains 'founder')
	})[0]
	if ($candidate) { return $candidate.pubKeyHash }
	$null
}
if ($resolvedTarget) {
	$ownerSuccessionTarget = [string]$resolvedTarget
	$targetPubKeyHash = $ownerSuccessionTarget
}
else {
	$stateB = Api $FedB GET "/groups/$groupId/state"
	if ($stateB.status -eq 200 -and $stateB.json.state.viewerMemberPubKeyHash) {
		$targetPubKeyHash = [string]$stateB.json.state.viewerMemberPubKeyHash
		$ownerSuccessionTarget = $targetPubKeyHash
	}
}

Write-Host "`n=== 1. Reputation slash fanout ===" -ForegroundColor Cyan
if ($targetPubKeyHash) {
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
		Api $FedA POST "/groups/$groupId/federation/catchup" @{ waitMs = 12000 } | Out-Null
		Api $FedA POST "/groups/$groupId/dag/merge-tips" @{} | Out-Null
		$events = Api $FedA GET "/groups/$groupId/events?limit=20"
		@($events.json.events | Where-Object { $_.type -eq 'reputation_slash' }).Count -ge 1
	}
	Test-Case 'B GET reputation reflects slash (fanout/catchup)' {
		$ok = PollUntil 300 4 {
			Api $FedB POST "/groups/$groupId/federation/catchup" @{ waitMs = 12000 } | Out-Null
			Api $FedB POST "/groups/$groupId/dag/merge-tips" @{} | Out-Null
			$events = Api $FedB GET "/groups/$groupId/events?limit=40"
			if ($events.status -ne 200) { return $false }
			@($events.json.events | Where-Object {
				$_.type -eq 'reputation_slash' -and $_.content.targetPubKeyHash -eq $targetPubKeyHash
			}).Count -ge 1
		}
		if (-not $ok) { throw 'B must receive reputation_slash via federation catchup (no manual A-side inject)' }
		$true
	}
}
else {
	Skip-Case 'reputation slash fanout' 'B member pubkey not resolved'
}

Write-Host "`n=== 2. Owner-succession cross-node ===" -ForegroundColor Cyan
if ($ownerSuccessionTarget) {
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
		Api $FedB POST "/groups/$groupId/federation/catchup" @{ waitMs = 20000 } | Out-Null
		$ok = PollUntil 120 4 {
			Api $FedB POST "/groups/$groupId/federation/catchup" @{ waitMs = 8000 } | Out-Null
			Api $FedB POST "/groups/$groupId/dag/merge-tips" @{} | Out-Null
			$stateResponse = Api $FedB GET "/groups/$groupId/state"
			if ($stateResponse.status -ne 200) { return $false }
			& $hasTransferredFounder $stateResponse.json.state
		}
		if (-not $ok) { throw 'B must see owner succession via federation catchup (no manual A-side inject)' }
		[bool]$ok
	}
}
else {
	Skip-Case 'owner-succession cross-node' 'B member pubkey not resolved'
}

Clear-FedGroup $groupId
Write-FedSummary 'FED-REP-OWNER' $groupId
Complete-LiveScript
