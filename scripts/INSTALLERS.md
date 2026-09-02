# Installers

Local SQLite path: `dirs::data_dir()/PetCareClinic/pet_care.sqlite`  
(also clears identifier folders `com.petcare.clinic` when present).

Installers wipe **local** app data only. MongoDB Atlas `petcare` is not touched.

## macOS — `.pkg` (recommended)

Proper installer with a **preinstall** script that deletes local data for all users, then installs the app into `/Applications`.

```bash
npm run build:macos:pkg
```

Output:
`src-tauri/target/release/bundle/pkg/Waleed_Pet_Care_Clinic_<version>_macos.pkg`

Scripts: `scripts/build-macos-pkg.sh`, `scripts/macos/preinstall`, `scripts/macos/postinstall`.

### macOS — DMG (no data wipe)

Drag-to-Applications only; does **not** run wipe scripts:

```bash
npm run build:macos
```

## Windows — NSIS `.exe`

Build on **Windows** (or CI) with the MSVC toolchain. NSIS runs `src-tauri/windows/hooks.nsh`:

- `NSIS_HOOK_PREINSTALL` — wipe before install
- `NSIS_HOOK_POSTUNINSTALL` — wipe after uninstall

Clears `%APPDATA%` / `%LOCALAPPDATA%` for `PetCareClinic`, `com.petcare.clinic`, and product-name variants.

```bash
npm run build:windows:installer
```

Output under:
`src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`

### Cross-compile from macOS

NSIS wipe hooks require a native Windows NSIS build. From macOS you can only produce a portable app binary (no installer wipe):

```bash
npm run build:windows:mac-cross
```

Configured in `tauri.conf.json` → `bundle.windows.nsis.installerHooks`.
