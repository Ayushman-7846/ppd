$ErrorActionPreference = "Stop"
$project = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $project "backend")
try {
    & ./.venv/Scripts/python.exe -m pytest -q
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Pop-Location
}
Push-Location (Join-Path $project "frontend")
try {
    npm.cmd test
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Pop-Location
}
