param(
  [string]$ReleaseDirectory = (Join-Path $PSScriptRoot '..\release'),
  [string]$ExtensionDirectory = (Join-Path $PSScriptRoot '..\..\..\packages\vscode-extension')
)

$ErrorActionPreference = 'Stop'
$releasePath = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$required = @('Fixora-Setup.exe', 'latest.yml')
$artifacts = [System.Collections.Generic.List[string]]::new()

foreach ($name in $required) {
  $path = Join-Path $releasePath $name
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Required release artifact is missing: $name."
  }
  $artifacts.Add($path)
}

$blockmap = Join-Path $releasePath 'Fixora-Setup.exe.blockmap'
if (Test-Path -LiteralPath $blockmap -PathType Leaf) { $artifacts.Add($blockmap) }
$vsixFiles = @(Get-ChildItem -LiteralPath $ExtensionDirectory -Filter '*.vsix' -File)
if ($vsixFiles.Count -eq 0) { throw 'VS Code extension artifact is missing.' }
$vsixFiles | ForEach-Object { $artifacts.Add($_.FullName) }

$lines = foreach ($artifact in $artifacts) {
  $hash = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  $(Split-Path -Leaf $artifact)"
}

$checksumPath = Join-Path $releasePath 'SHA256SUMS.txt'
[System.IO.File]::WriteAllLines($checksumPath, $lines, [System.Text.Encoding]::ASCII)
Write-Host "Wrote SHA-256 checksums for $($artifacts.Count) release artifacts."
