// Filled in after deploying to X Layer mainnet (contracts/script/DeployNightwire.s.sol).
// Until then on-chain features stay hidden; for testing pass ?rpc=…&ladder=…&engine=… in the URL.
export const DEPLOY = {
  chainId: 196,
  rpc: 'https://rpc.xlayer.tech',
  explorer: 'https://www.oklink.com/xlayer',
  armory: null, // TapeOut processor holding the war-machine brain chips
  brainIds: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  engine: null,
  ladder: null,
  raid: null, // NightwireRaid (World Boss)
  shop: null, // NightwireShop (cosmetics + war-machine tape-outs, paid in OKB)
  api: 'https://api-production-fbf29f4a.up.railway.app', // Railway service (server/index.mjs)
};
