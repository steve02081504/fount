Set-Title "𝓯𝓸𝓾𝓷𝓽"
Write-TaskbarProgress -Percent 0
run shutdown
Write-TaskbarProgress -Percent 5
deno clean
Write-TaskbarProgress -Percent 15
Write-Host (Get-I18n -key 'remove.removing.fount.main')
