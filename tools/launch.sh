#!/usr/bin/env bash
# Puts Nightwire on X Layer mainnet the low-cost way (about 0.015 OKB, no BEM):
#   1. tape out the 9 brain chips on an existing TapeOut processor with free transistors (FAQ: allowed)
#   2. deploy the engine, ladder, raid and shop contracts (gas only)
#   3. optional: host the game on DeWEB (0.08 OKB container) - the Vercel link already satisfies the rules
# Needs foundry + node and a keystore account: cast wallet import nightwire-deployer --interactive
set -euo pipefail
cd "$(dirname "$0")/.."
RPC=${RPC:-https://rpc.xlayer.tech}
ACCOUNT=${ACCOUNT:-nightwire-deployer}
PROCESSOR=${PROCESSOR:-0x7335a50819d44402e3D5E00239bBB80A13E7308F} # TapeOut processor #180: transistors free, fees in OKB
ADDR=$(cast wallet address --account "$ACCOUNT")
ask() { read -r -p "$1 [y/N] " a; [[ "$a" == "y" ]] || { echo "stopped"; exit 1; }; }

echo "deployer $ADDR on chain $(cast chain-id --rpc-url "$RPC"), balance $(cast balance "$ADDR" --rpc-url "$RPC" -e) OKB"
node tools/chips.mjs >/dev/null
(cd contracts && forge build >/dev/null) && echo "contracts build"

ask "1/2 Tape out the 9 war-machine brain chips on processor $PROCESSOR (about 0.013 OKB)?"
OUT=$(cd contracts && PROCESSOR=$PROCESSOR forge script script/DeployBrains.s.sol --rpc-url "$RPC" --account "$ACCOUNT" --broadcast --slow 2>&1)
FIRST=$(echo "$OUT" | awk '/^  brain 0 circuit id/{print $5}')
echo "$OUT" | grep -E "^  (brain|OKB)"
[[ -n "$FIRST" ]] || { echo "tape-out failed"; echo "$OUT" | tail -20; exit 1; }

ask "2/2 Deploy engine + ladder + raid + shop (gas only, well under 0.001 OKB)?"
OUT=$(cd contracts && BRAINS_PROCESSOR=$PROCESSOR BRAIN_FIRST_ID=$FIRST forge script script/DeployNightwire.s.sol --rpc-url "$RPC" --account "$ACCOUNT" --broadcast --slow 2>&1)
get() { echo "$OUT" | awk -v k="$1" '$1==k{print $2}'; }
ENGINE=$(get engine); LADDER=$(get ladder); RAID=$(get raid); SHOP=$(get shop)
echo "engine $ENGINE  ladder $LADDER  raid $RAID  shop $SHOP"
[[ -n "$SHOP" ]] || { echo "deploy failed"; echo "$OUT" | tail -20; exit 1; }

node -e "
const fs=require('fs');let s=fs.readFileSync('src/deploy.js','utf8');
const ids=Array.from({length:9},(_,i)=>$FIRST+i);
s=s.replace(/armory: [^,]*,/,'armory: \'$PROCESSOR\',').replace(/brainIds: \[[^\]]*\]/,'brainIds: ['+ids.join(', ')+']')
 .replace(/engine: [^,]*,/,'engine: \'$ENGINE\',').replace(/ladder: [^,]*,/,'ladder: \'$LADDER\',').replace(/raid: [^,]*,/,'raid: \'$RAID\',').replace(/shop: [^,]*,/,'shop: \'$SHOP\',');
fs.writeFileSync('src/deploy.js',s);
let c=fs.readFileSync('src/chips.js','utf8');
c=c.replace(/export const ONCHAIN = .*;/,'export const ONCHAIN = { chainId: 196, processor: \'$PROCESSOR\', first: $FIRST };');
fs.writeFileSync('src/chips.js',c);"
echo "src/deploy.js and src/chips.js updated. Commit them, then: vercel deploy --prod"

read -r -p "Optional: also host the game on X Layer DeWEB (container 0.08 OKB)? [y/N] " a
if [[ "$a" == "y" ]]; then
  node tools/deweb-manifest.mjs >/dev/null
  (cd contracts && ARMORY=$PROCESSOR CIRCUIT_ID=$FIRST forge script script/PublishDeweb.s.sol --rpc-url "$RPC" --account "$ACCOUNT" --broadcast --slow 2>&1 | grep -E "^  (container|name|live|url)")
fi
echo "done."
