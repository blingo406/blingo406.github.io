param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$blogRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$address = 'http://127.0.0.1:4399/'
$running = $false
try { $response = Invoke-WebRequest -Uri $address -UseBasicParsing -TimeoutSec 2; $running = $response.Content -match 'Mizuki Studio' } catch { }
if (-not $running) {
    $node = (Get-Command node -ErrorAction Stop).Source
    $serverPath = Join-Path $PSScriptRoot 'server.mjs'
    $logDirectory = Join-Path $blogRoot '.blog-manager'
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    $process = Start-Process -FilePath $node -ArgumentList @('"' + $serverPath + '"') -WorkingDirectory $blogRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDirectory 'server.log') -RedirectStandardError (Join-Path $logDirectory 'server-error.log') -PassThru
    $process.Id | Set-Content -LiteralPath (Join-Path $logDirectory 'server.pid')
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 300
        try { $response = Invoke-WebRequest -Uri $address -UseBasicParsing -TimeoutSec 1; $running = $response.Content -match 'Mizuki Studio'; if ($running) { break } } catch { }
        if ($process.HasExited) { break }
    }
    if (-not $running) { throw "Could not start Blog Manager. See $logDirectory\server-error.log" }
}
if (-not $NoOpen) { Start-Process $address }
