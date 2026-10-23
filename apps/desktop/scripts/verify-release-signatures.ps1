param(
  [string]$ReleaseDirectory = (Join-Path $PSScriptRoot '..\release'),
  [ValidateSet('signed', 'unsigned')]
  [string]$SigningMode = $env:RELEASE_SIGNING_MODE,
  [string]$Publisher = $env:AZURE_TRUSTED_SIGNING_PUBLISHER,
  [string]$ExpectedVersion = $env:EXPECTED_RELEASE_VERSION
)

$ErrorActionPreference = 'Stop'
$releasePath = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$artifacts = @(
  (Join-Path $releasePath 'Fixora-Setup.exe'),
  (Join-Path $releasePath 'win-unpacked\Fixora.exe')
)

if ([string]::IsNullOrWhiteSpace($SigningMode)) {
  throw 'Release verification requires an explicit signed or unsigned mode.'
}
if ($SigningMode -eq 'signed' -and [string]::IsNullOrWhiteSpace($Publisher)) {
  throw 'Signature verification requires the configured release publisher name.'
}
if ([string]::IsNullOrWhiteSpace($ExpectedVersion)) {
  throw 'Release verification requires the canonical tag version.'
}

$manifestPath = Join-Path $PSScriptRoot '..\package.json'
$manifestVersion = (Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json).version
if ($manifestVersion -ne $ExpectedVersion) {
  throw 'Desktop package version does not match the canonical release tag.'
}
$latestPath = Join-Path $releasePath 'latest.yml'
if (-not (Test-Path -LiteralPath $latestPath -PathType Leaf)) {
  throw 'Updater metadata is missing; refusing to publish an incomplete release.'
}
$latestContent = Get-Content -LiteralPath $latestPath -Raw
$latestVersion = [regex]::Match($latestContent, '(?m)^version:\s*["'']?([^"''\r\n]+)["'']?\s*$')
if (-not $latestVersion.Success -or $latestVersion.Groups[1].Value -ne $ExpectedVersion) {
  throw 'Updater metadata version does not match the canonical release tag.'
}
$expectedInstaller = 'Fixora-Setup.exe'
$latestInstallerPath = [regex]::Match($latestContent, '(?m)^path:\s*["'']?([^"''\r\n]+)["'']?\s*$')
$latestUrl = [regex]::Match($latestContent, '(?m)^\s+-\s+url:\s*["'']?([^"''\r\n]+)["'']?\s*$')
$latestSha512 = [regex]::Match($latestContent, '(?m)^sha512:\s*["'']?([^"''\r\n]+)["'']?\s*$')
if (
  -not $latestInstallerPath.Success -or $latestInstallerPath.Groups[1].Value -cne $expectedInstaller -or
  -not $latestUrl.Success -or $latestUrl.Groups[1].Value -cne $expectedInstaller -or
  -not $latestSha512.Success
) {
  throw 'Updater metadata does not identify the expected installer.'
}
$installerPath = Join-Path $releasePath $expectedInstaller
if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
  throw 'The installer referenced by updater metadata is missing.'
}
$installerHashHex = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA512).Hash
$installerHashBytes = [byte[]]::new([int]($installerHashHex.Length / 2))
for ($index = 0; $index -lt $installerHashBytes.Length; $index++) {
  $installerHashBytes[$index] = [Convert]::ToByte($installerHashHex.Substring($index * 2, 2), 16)
}
$installerHashBase64 = [Convert]::ToBase64String($installerHashBytes)
if ($latestSha512.Groups[1].Value -cne $installerHashBase64) {
  throw 'Updater metadata hash does not match the signed installer.'
}

foreach ($artifact in $artifacts) {
  if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
    throw "Required release artifact is missing: $(Split-Path -Leaf $artifact)."
  }
}

if ($SigningMode -eq 'signed') {
  $signToolPath = (Get-Command 'signtool.exe' -ErrorAction SilentlyContinue).Path
  if ([string]::IsNullOrWhiteSpace($signToolPath)) {
    $sdkBin = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    $signToolPath = Get-ChildItem -Path (Join-Path $sdkBin '*\x64\signtool.exe') -ErrorAction SilentlyContinue |
      Sort-Object -Property { [version]$_.Directory.Parent.Name } -Descending |
      Select-Object -ExpandProperty FullName -First 1
  }
  if ([string]::IsNullOrWhiteSpace($signToolPath)) {
    throw 'Windows SignTool was not found; refusing to publish unverified artifacts.'
  }

  foreach ($artifact in $artifacts) {
    $output = & $signToolPath verify /pa /v $artifact 2>&1
    $exitCode = $LASTEXITCODE
    $transcript = $output -join "`n"
    $output | ForEach-Object { Write-Host $_ }
    if ($exitCode -ne 0) {
      throw "Authenticode verification failed for $(Split-Path -Leaf $artifact)."
    }
    if ($transcript -notmatch 'The signature is timestamped:') {
      throw "A valid RFC3161 timestamp was not reported for $(Split-Path -Leaf $artifact)."
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $artifact
    if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
      throw "Authenticode signature is not valid for $(Split-Path -Leaf $artifact)."
    }
    if ($null -eq $signature.TimeStamperCertificate) {
      throw "A valid signing timestamp is missing for $(Split-Path -Leaf $artifact)."
    }
    $actualCommonName = $signature.SignerCertificate.GetNameInfo(
      [System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName,
      $false
    )
    $actualSubject = $signature.SignerCertificate.Subject
    if ($actualCommonName -cne $Publisher -and $actualSubject -cne $Publisher) {
      throw "Expected release publisher was not reported for $(Split-Path -Leaf $artifact)."
    }
  }

  Write-Host 'Installer and packaged application signatures, publisher, and timestamp verified.'
} else {
  foreach ($artifact in $artifacts) {
    $signature = Get-AuthenticodeSignature -LiteralPath $artifact
    if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::NotSigned) {
      throw "Unsigned release expected, but $(Split-Path -Leaf $artifact) reports signature status $($signature.Status)."
    }
  }
  Write-Warning 'Unsigned release selected; signature, publisher, and timestamp are not verified.'
  Write-Host 'Installer and packaged application are confirmed unsigned.'
}

Write-Host 'Release version, installer, and updater metadata verified.'
