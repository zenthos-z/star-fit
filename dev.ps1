# Starfit Browser Opener
$ErrorActionPreference = "Continue"

$Host.UI.RawUI.WindowTitle = "Starfit Browser Opener"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Starfit Browser Opener" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Define Chrome debug config (isolated profile, no extensions)
$ChromeDebugPath = "$env:LOCALAPPDATA\Starfit\ChromeDebug"
$ChromeExe = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $ChromeExe)) {
    $ChromeExe = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
}

# Configuration
$FrontendUrl = "http://127.0.0.1:43112"
$BackendUrl = "http://127.0.0.1:43111"
$PortManagerUrl = "http://127.0.0.1:43113"

# Start Port Manager in background
$PortManagerScript = "$PSScriptRoot\.claude\skills\port-manager\port-manager-server.mjs"
if (Test-Path $PortManagerScript) {
    Write-Host "Starting Port Manager..." -ForegroundColor Yellow
    Start-Process node -ArgumentList $PortManagerScript -WindowStyle Hidden
    Start-Sleep -Milliseconds 500
}

Write-Host "Opening Chrome for debugging..." -ForegroundColor Green
Write-Host "- Frontend:  $FrontendUrl" -ForegroundColor White
Write-Host "- Admin:     $FrontendUrl/admin" -ForegroundColor White
Write-Host "- Port Mgr:  $PortManagerUrl" -ForegroundColor White
Write-Host ""

$ChromeArgs = @(
    "--remote-debugging-port=9222",
    "--user-data-dir=$ChromeDebugPath",
    "--disable-extensions",
    "--new-window",
    $FrontendUrl,
    "$FrontendUrl/admin",
    $PortManagerUrl,
)

try {
    Start-Process $ChromeExe -ArgumentList $ChromeArgs -ErrorAction Stop
    Write-Host "Browser opened successfully!" -ForegroundColor Green
    Write-Host "- Chrome Debug: localhost:9222" -ForegroundColor White
}
catch {
    Write-Host "Failed to open Chrome: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please ensure:" -ForegroundColor Yellow
    Write-Host "1. Chrome is installed" -ForegroundColor White
    Write-Host "2. Backend service is running (cd backend ^&^& npm run dev)" -ForegroundColor White
    Write-Host "3. Frontend service is running (npm run dev)" -ForegroundColor White
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Done!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
