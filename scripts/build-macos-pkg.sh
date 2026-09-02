#!/bin/bash
# Build a proper macOS .pkg installer that:
#  1) Clears local Pet Care Clinic data (SQLite + caches) during install
#  2) Installs Waleed Pet Care Clinic.app into /Applications
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

PRODUCT="Waleed Pet Care Clinic"
IDENTIFIER="com.petcare.clinic"
VERSION="$(node -p "require('./package.json').version")"

echo "==> Building Tauri macOS app bundle..."
npm run tauri -- build --bundles app

APP_SRC="${ROOT}/src-tauri/target/release/bundle/macos/${PRODUCT}.app"
if [[ ! -d "${APP_SRC}" ]]; then
  echo "ERROR: App bundle not found at ${APP_SRC}" >&2
  exit 1
fi

STAGING="$(mktemp -d)"
SCRIPTS_DIR="$(mktemp -d)"
PKG_ROOT="${STAGING}/root"
mkdir -p "${PKG_ROOT}/Applications"
cp -R "${APP_SRC}" "${PKG_ROOT}/Applications/"

cp "${ROOT}/scripts/macos/preinstall" "${SCRIPTS_DIR}/preinstall"
cp "${ROOT}/scripts/macos/postinstall" "${SCRIPTS_DIR}/postinstall"
chmod 755 "${SCRIPTS_DIR}/preinstall" "${SCRIPTS_DIR}/postinstall"

OUT_DIR="${ROOT}/src-tauri/target/release/bundle/pkg"
mkdir -p "${OUT_DIR}"
COMPONENT_PKG="${OUT_DIR}/${PRODUCT// /_}-component.pkg"
FINAL_PKG="${OUT_DIR}/${PRODUCT// /_}_${VERSION}_macos.pkg"

echo "==> Building component package (with preinstall data wipe)..."
pkgbuild \
  --root "${PKG_ROOT}" \
  --scripts "${SCRIPTS_DIR}" \
  --identifier "${IDENTIFIER}" \
  --version "${VERSION}" \
  --install-location "/" \
  "${COMPONENT_PKG}"

echo "==> Building product package..."
productbuild \
  --package "${COMPONENT_PKG}" \
  "${FINAL_PKG}"

rm -f "${COMPONENT_PKG}"
rm -rf "${STAGING}" "${SCRIPTS_DIR}"

echo ""
echo "macOS installer ready:"
echo "  ${FINAL_PKG}"
echo ""
echo "Double-click the .pkg to install. It will:"
echo "  • Delete local SQLite and app data (Library/Application Support/PetCareClinic)"
echo "  • Install ${PRODUCT}.app into /Applications"
