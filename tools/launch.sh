#!/usr/bin/env bash
# Puts Nightwire on X Layer mainnet. Every step spends real OKB/BEM, so each one asks first.
# Needs: foundry, node, a keystore account (cast wallet import nightwire-deployer --interactive) holding
# about 0.1 OKB and 0.25 BEM. Rehearse first on a fork: anvil --fork-url https://rpc.xlayer.tech
set -euo pipefail
cd "$(dirname "$0")/.."
RPC=${RPC:-https://rpc.xlayer.tech}
ACCOUNT=${ACCOUNT:-nightwire-deployer}
ADDR=$(cast wallet address --account "$ACCOUNT")
BEM=0x60e62Efa9405d6873C5deaBD4E6CC91c25363952
ask() { read -r -p "$1 [y/N] " a; [[ "$a" == "y" ]] || { echo "stopped"; exit 1; }; }

echo "deployer $ADDR on $(cast chain-id --rpc-url "$RPC")"
echo "OKB: $(cast balance "$ADDR" --rpc-url "$RPC" -e)   BEM: $(cast call $BEM 'balanceOf(address)(uint256)' "$ADDR" --rpc-url "$RPC" | cut -d' ' -f1) (8 decimals)"

node tools/chips.mjs
(cd contracts && forge test --gas-limit 900000000000 >/dev/null && echo "contract tests pass") || { echo "tests fail: fix before launch"; exit 1; }

ask "1/3 Create the Nightwire Armory processor and tape out the 4 brain chips (~0.2 BEM + ~0.006 OKB)?"
OUT=$(cd contracts && forge script script/DeployArmory.s.sol --rpc-url "$RPC" --account "$ACCOUNT" --broadcast --slow 2>&1)
ARMORY=$(echo "$OUT" | awk '/^  processor/{print $2}'); echo "armory $ARMORY"

ask "2/3 Deploy NightwireEngine + NightwireLadder (gas only, < 0.001 OKB)?"
OUT=$(cd contracts && ARMORY=$ARMORY forge script script/DeployNightwire.s.sol --rpc-url "$RPC" --account "$ACCOUNT" --broadcast --slow 2>&1)
ENGINE=$(echo "$OUT" | awk '/^  engine/{print $2}'); LADDER=$(echo "$OUT" | awk '/^  ladder/{print $2}')
echo "engine $ENGINE  ladder $LADDER"
node -e "
const fs=require('fs');let s=fs.readFileSync('src/deploy.js','utf8');
s=s.replace(/armory: [^,]*,/,'armory: \'$ARMORY\',').replace(/engine: [^,]*,/,'engine: \'$ENGINE\',').replace(/ladder: [^,]*,/,'ladder: \'$LADDER\',');
fs.writeFileSync('src/deploy.js',s);"
sed -i '' "s/onchain: null/onchain: '$ARMORY'/" src/chips.js 2>/dev/null || true

ask "3/3 Publish the game to DeWEB (container 0.08 OKB + ~0.001 OKB gas, name fee currently 0)?"
node tools/deweb-manifest.mjs
(cd contracts && ARMORY=$ARMORY forge script script/PublishDeweb.s.sol --rpc-url "$RPC" --account "$ACCOUNT" --broadcast --slow 2>&1 | grep -E "^  (container|name|live|url)")
echo "done. Commit src/deploy.js so the repo matches what is on chain."
