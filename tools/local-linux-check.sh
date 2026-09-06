#!/usr/bin/env bash
# Isolated local validation; never installs system packages or changes the source checkout.
set -euo pipefail
source_root="$(cd "$(dirname "$0")/.." && pwd)"
task_root="$(mktemp -d /var/tmp/anatria-stability.XXXXXX)"
printf 'LINUX_VALIDATION_ROOT=%s\n' "$task_root"
git -c safe.directory="$source_root" -C "$source_root" ls-files --cached --others --exclude-standard -z \
  | tar -C "$source_root" --null -T - -cf - \
  | tar -C "$task_root" -xf -
cd "$task_root"
mkdir -p .tooling/bin .tooling/node
node_archive=node-v24.19.0-linux-x64.tar.xz
curl --fail --location --retry 2 "https://nodejs.org/dist/v24.19.0/$node_archive" -o ".tooling/$node_archive"
curl --fail --location --retry 2 https://nodejs.org/dist/v24.19.0/SHASUMS256.txt -o .tooling/SHASUMS256.txt
(cd .tooling && awk -v name="$node_archive" '$2 == name {print}' SHASUMS256.txt | sha256sum --check --strict)
tar -xJf ".tooling/$node_archive" -C .tooling/node --strip-components=1
export PATH="$task_root/.tooling/node/bin:$task_root/.tooling/bin:$PATH"
export COREPACK_HOME="$task_root/.tooling/corepack"
corepack enable --install-directory "$task_root/.tooling/bin" pnpm
node --version
pnpm --version
pnpm install --frozen-lockfile
python3.12 -m venv --without-pip .venv
# Bootstrap only the isolated venv; Ubuntu need not have python3.12-venv installed.
curl --fail --location --retry 2 https://bootstrap.pypa.io/get-pip.py -o .tooling/get-pip.py
.venv/bin/python .tooling/get-pip.py
.venv/bin/python -m pip install -e 'engine[dev]'
export PATH="$task_root/.venv/bin:$PATH"
node tools/check-version.mjs
pnpm typecheck
pnpm test
python -m pytest engine -q
python -m ruff check engine
pnpm sidecar:build
node tools/smoke-sidecar.mjs
python3.12 -m venv --without-pip tools/anatria_mcp/.venv
tools/anatria_mcp/.venv/bin/python .tooling/get-pip.py
tools/anatria_mcp/.venv/bin/python -m pip install 'mcp>=2.1,<3' pytest anyio
tools/anatria_mcp/.venv/bin/python -m pytest tools/anatria_mcp -q
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
pnpm tauri build --bundles deb
node tools/smoke-sidecar.mjs
printf 'LINUX_VALIDATION_COMPLETE=%s\n' "$task_root"
sha256sum src-tauri/target/release/bundle/deb/*.deb
