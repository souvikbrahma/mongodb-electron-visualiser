#!/bin/zsh -l

# Finder opens .command files in Terminal. Resolve the project from this file,
# so launching works regardless of Terminal's current directory.
set -eu
cd -- "${0:A:h}"

fail() {
  print -u2 -- "\n$1"
  if [[ -t 0 ]]; then
    read -r '?Press Enter to close...'
  fi
  exit 1
}

# Finder may have a smaller PATH than an interactive shell.
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
if ! command -v node >/dev/null 2>&1; then
  for node_bin in /opt/homebrew/opt/node*/bin(N) /usr/local/opt/node*/bin(N); do
    if [[ -x "$node_bin/node" ]]; then
      export PATH="$node_bin:$PATH"
      break
    fi
  done
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  fail 'Node.js and npm are required. Install Node.js, then double-click this file again.'
fi

print -- 'Starting Mongo Visualiser...'
if ! npm ls --depth=0 --silent >/dev/null 2>&1 \
  || [[ ! -x node_modules/.bin/electron || ! -x node_modules/.bin/esbuild ]]; then
  print -- 'Installing project dependencies (internet connection required)...'
  npm ci --include=dev || fail 'Dependency installation failed. Check your connection and try again.'
fi

# Some developer environments set this flag, which prevents Electron opening a window.
unset ELECTRON_RUN_AS_NODE
npm start || fail 'Mongo Visualiser could not start. See the error above.'
