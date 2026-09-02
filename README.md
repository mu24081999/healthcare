# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Build Windows `.exe`

- Build on Windows (MSVC target):
  - `rustup target add x86_64-pc-windows-msvc`
  - `npm run build:windows`

- Build on macOS via cross-compile (GNU target):
  - `brew install llvm mingw-w64`
  - `rustup target add x86_64-pc-windows-gnu`
  - `npm run build:windows:mac-cross`

- Output files:
  - Windows-native build: `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/`
  - macOS cross-build executable: `src-tauri/target/x86_64-pc-windows-gnu/release/tauri-app.exe`

Notes:
- On macOS/Linux, cross-compiling a signed Windows installer may require extra tooling (Windows linker/toolchain).
- The most reliable path is to run this command on a Windows machine or in Windows CI.
