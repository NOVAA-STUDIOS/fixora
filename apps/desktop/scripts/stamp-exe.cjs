// electron-builder `afterPack` hook — writes the Fixora icon into the packaged Fixora.exe.
//
// WHY THIS EXISTS, rather than `signAndEditExecutable: true`.
//
// That flag is the supported way to do this, and it gates TWO things: code signing (which we do not
// do yet — ADR-021 defers it to the paid launch) and rcedit's rewrite of the exe's resources (which
// we want). Turning it on makes electron-builder extract the winCodeSign toolchain first, and that
// archive contains macOS symlinks. Creating a symlink on Windows needs SeCreateSymbolicLinkPrivilege,
// so on a machine without Developer Mode the extraction fails and takes the whole build with it:
//
//   ERROR: Cannot create symbolic link : A required privilege is not held by the client.
//          …winCodeSign\<id>\darwin\10.12\lib\libcrypto.dylib
//
// Verified, not assumed: the flag was turned on and `electron-builder --dir` failed with exactly
// that. So the icon is written here instead, with `resedit` — the same pure-JS PE resource editor
// electron-builder itself uses, requiring no toolchain download, no symlinks and no elevation.
//
// The timing is the point. `afterPack` runs after the app directory is assembled and BEFORE NSIS
// packs it into the installer, so the installer, the installed copy, and every shortcut pointing at
// the exe all carry the stamped icon. Doing this in `postpackage` would be too late — the installer
// would already contain the unstamped binary.
//
// Also rewrites the version resource below (ProductName/FileDescription/CompanyName), the other
// half of what `signAndEditExecutable` would fix — same rationale, same pure-JS `resedit` path.
//
// CommonJS because electron-builder `require`s hook files.
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const ResEdit = require('resedit');

/** Language for the resource entry: en-US, Unicode. Matches what electron-builder writes. */
const LANG_EN_US = 1033;

exports.default = async function stampExe(context) {
  // macOS and Linux carry their icons as bundle/desktop files, which electron-builder already
  // handles from build/icon.png. This is a Windows PE concern only.
  if (context.electronPlatformName !== 'win32') return;

  const exePath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const icoPath = join(__dirname, '..', 'build', 'icon.ico');

  const exe = ResEdit.NtExecutable.from(readFileSync(exePath));
  const resource = ResEdit.NtExecutableResource.from(exe);
  const icon = ResEdit.Data.IconFile.from(readFileSync(icoPath));

  // Replaces icon group 1 — the group Windows shows for the executable, and the one a shortcut
  // resolves when its IconLocation is "…\Fixora.exe,0". Every size in the .ico goes in, so the
  // shell picks the right one per context instead of downscaling a single 256px image.
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    resource.entries,
    1,
    LANG_EN_US,
    icon.icons.map((item) => item.data),
  );

  // The version resource — ProductName/FileDescription/CompanyName — is the other half of what
  // `signAndEditExecutable` would fix (see file header). Each existing language block gets the
  // same three keys, rather than assuming en-US is the only one electron-builder wrote.
  for (const versionInfo of ResEdit.Resource.VersionInfo.fromEntries(resource.entries)) {
    for (const lang of versionInfo.getAllLanguagesForStringValues()) {
      versionInfo.setStringValues(lang, {
        ProductName: 'Fixora',
        FileDescription: 'Fixora - AI Code Repair',
        CompanyName: 'NOVAA Studios',
        // Task Manager's "Name" column and the exe Properties dialog both fall back to these when
        // present — left at electron-builder's default ("Electron"/"electron.exe") otherwise, which
        // is what showed "Electron" even with ProductName/FileDescription already correct.
        InternalName: 'Fixora',
        OriginalFilename: 'Fixora.exe',
      });
    }
    versionInfo.outputToResourceEntries(resource.entries);
  }

  resource.outputResource(exe);
  writeFileSync(exePath, Buffer.from(exe.generate()));

  console.log(
    `stamp-exe: wrote ${String(icon.icons.length)} icon sizes and version info into ${exePath}`,
  );
};
