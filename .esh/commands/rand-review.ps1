$ErrorActionPreference = 'Stop'

function Get-MainBranchRef {
	$symbolic = git symbolic-ref refs/remotes/origin/HEAD 2>$null
	if ($LASTEXITCODE -eq 0 -and $symbolic) { return $symbolic.Trim() }
	foreach ($candidate in @('origin/master', 'origin/main', 'master', 'main')) {
		git rev-parse --verify --quiet $candidate | Out-Null
		if ($LASTEXITCODE -eq 0) { return $candidate }
	}
	throw '找不到主分支（origin/HEAD / master / main）'
}

function Get-MainBranchName([string]$Ref) {
	$Ref -replace '^refs/remotes/origin/', '' -replace '^origin/', ''
}

function Resolve-NumstatPath([string]$Path) {
	if ($Path -notmatch ' => ') { return $Path }
	if ($Path -match '^(.*)\{(.*) => (.*)\}(.*)$') {
		return "$($Matches[1])$($Matches[3])$($Matches[4])"
	}
	($Path -split ' => ', 2)[1]
}

function Add-WeightedFile([hashtable]$Weights, [string]$Path, [int]$Added) {
	if ($Added -le 0) { return }
	if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
	$Weights[$Path] = ($Weights[$Path] ?? 0) + $Added
}

$repoRoot = (git rev-parse --show-toplevel).Trim()
Set-Location $repoRoot

$mainRef = Get-MainBranchRef
$mainName = Get-MainBranchName $mainRef
$current = (git branch --show-current).Trim()
if (-not $current -or $current -eq $mainName) {
	$shown = if ($current) { $current } else { 'detached' }
	Write-Error "rand-review 仅在非主分支可用（当前: $shown，主分支: $mainName）"
	exit 1
}

$base = (git merge-base HEAD $mainRef).Trim()
$weights = @{}

git -c core.quotepath=false diff --numstat --diff-filter=d $base | ForEach-Object {
	$parts = $_ -split "`t", 3
	if ($parts.Count -lt 3) { return }
	if ($parts[0] -eq '-') { return } # binary
	$path = Resolve-NumstatPath $parts[2]
	Add-WeightedFile $weights $path ([int]$parts[0])
}

git -c core.quotepath=false ls-files -o --exclude-standard | ForEach-Object {
	$path = $_
	$full = Join-Path $repoRoot $path
	if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { return }
	$added = ([System.IO.File]::ReadAllLines($full)).Length
	Add-WeightedFile $weights $path $added
}

if ($weights.Count -eq 0) {
	Write-Error '相对主分支没有可打开的新增/改动文件'
	exit 1
}

$total = 0
foreach ($n in $weights.Values) { $total += $n }

$roll = Get-Random -Maximum $total
$acc = 0
$picked = $null
foreach ($entry in $weights.GetEnumerator()) {
	$acc += $entry.Value
	if ($roll -lt $acc) {
		$picked = $entry.Key
		$pickedWeight = $entry.Value
		break
	}
}

Write-Host "$picked  (+$pickedWeight / $total)"

$full = Join-Path $repoRoot $picked
if (Get-Command cursor -ErrorAction SilentlyContinue) { cursor $full }
elseif (Get-Command code -ErrorAction SilentlyContinue) { code $full }
else { Invoke-Item -LiteralPath $full }
