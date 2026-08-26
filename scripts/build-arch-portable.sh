#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(node -p "require('${project_root}/desktop/package.json').version")"
archive_root="mind-jam-${version}-arch-x86_64"
staging_dir="${project_root}/release/${archive_root}"
archive_path="${project_root}/release/${archive_root}.tar.zst"

mkdir -p "${staging_dir}"

(
  cd "${project_root}/desktop"
  pnpm install --frozen-lockfile
  MIND_JAM_BUILD_VARIANT=arch-linux-system-gstreamer pnpm tauri build --no-bundle
)

install -m 0755 \
  "${project_root}/desktop/src-tauri/target/release/desktop" \
  "${staging_dir}/mind-jam"
cp "${project_root}/scripts/ARCH-LINUX-README.md" "${staging_dir}/README.md"

tar --zstd -cf "${archive_path}" \
  --transform="s,^,${archive_root}/," \
  -C "${staging_dir}" mind-jam README.md

sha256sum "${archive_path}"
