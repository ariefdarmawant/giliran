# Deploying Giliran

Everything runs on BNB Chain mainnet: the Agentic Wallet has no BSC testnet, and Agent ID names exist only on mainnet.
There is no server: one contract, a static site and the skill.

## 1. Deploy the contract

The live contract was deployed from an Agentic Wallet through the deterministic CREATE2 deployer
(`0x4e59b44847b379578588920cA78FbF26c0B4956C`), so the address is known before sending. It used 2,030,202 gas
(about 0.0001 BNB at 0.05 gwei).

```bash
cd contracts
forge test && FORK_TESTS=1 forge test --match-path test/Circle.fork.t.sol
BC=$(forge inspect Giliran bytecode)
ARGS=$(cast abi-encode "f(address)" 0x55d398326f99059fF775485246999027B3197955 | sed 's/^0x//')
SALT=$(jq -r .salt deployments/56.json)                                   # the salt the live contract used
cast create2 --deployer 0x4e59b44847b379578588920cA78FbF26c0B4956C --salt $SALT --init-code ${BC}${ARGS}   # the address
echo "${SALT}${BC#0x}${ARGS}"                                                                              # the calldata
```

Send that calldata to the deployer from the wallet (`baw contract-call preview`, then `execute`). From a keystore or a
Ledger instead, `forge script script/Deploy.s.sol --rpc-url bsc --broadcast` deploys with a plain `CREATE`.

Record the address, block and transaction in `contracts/deployments/56.json`.

## 2. Verify

Submit the standard JSON input to Sourcify's v2 API; Sourcify forwards it to BscScan.

```bash
forge verify-contract <address> src/Giliran.sol:Giliran --chain 56 --show-standard-json-input > deployments/Giliran.standard-input.json
```

Post `{stdJsonInput, compilerVersion, contractIdentifier: "src/Giliran.sol:Giliran", creationTransactionHash}` to
`https://sourcify.dev/server/v2/verify/56/<address>`, then check `https://sourcify.dev/server/v2/contract/56/<address>`
for `exact_match`.

## 3. Point the site and the skill at it

- `site/config.js`: `giliran` and `fromBlock` (the deploy block); `repo` and `skill` once the repository is public.
- `skills/giliran/scripts/giliran.mjs`: the `GILIRAN` default (or agents set `GILIRAN_ADDRESS`).
- Host `site/` as static files (Cloudflare Pages, Vercel, GitHub Pages). There is no build step.
- Agents install the skill with `npx skills add ariefdarmawant/giliran`.

## 4. First real circle

1. Three people who each hold a .ai name, have Developer Mode on and have a few USDT in their Agentic Wallet install
   the skill.
2. The organizer tells their agent, for example: "Buat arisan di giliran-app.vercel.app untuk a.ai, b.ai, c.ai. Iuran 1 USDT
   harian, urutan sesuai daftar." They confirm the create call and share `giliran-app.vercel.app/?c=<n>`.
3. Everyone, the organizer included, tells their agent "Ikut arisan Giliran #<n>." That is two confirmations: the exact
   approval, then the first iuran.
4. The last member's join pays out round 1 in the same transaction (in a drawn circle it starts the draw, and any
   member's agent finishes it with "buka kocokan").
5. `giliran-app.vercel.app/proof.html` shows the Agent ID wallets that paid, read from the contract.
