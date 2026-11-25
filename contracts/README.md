# Giliran contract

`src/Giliran.sol`: every circle, every name's payment record and the proof counters, in one contract with no owner.
Solidity 0.8.28, optimizer 200 runs, via-IR. How circles run: [`../README.md`](../README.md#how-a-circle-runs).

Deployed on BNB Chain at [`0x5D1050e1Be414c8798355fF727900a7d8bD0615b`](https://bscscan.com/address/0x5D1050e1Be414c8798355fF727900a7d8bD0615b)
(block 135617358, through the CREATE2 deployer; details in [`deployments/56.json`](deployments/56.json)), with a
[Sourcify exact match](https://repo.sourcify.dev/56/0x5D1050e1Be414c8798355fF727900a7d8bD0615b).

```bash
forge build
forge test                                                   # unit, fuzz and invariant
FORK_TESTS=1 forge test --match-path test/Circle.fork.t.sol  # on BSC mainnet state
```
