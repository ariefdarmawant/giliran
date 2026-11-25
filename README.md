# Giliran

**Arisan yang nggak bisa dibawa kabur.** The savings circle nobody can run off with.

Giliran runs an arisan, the rotating savings circle Indonesians already know, between Binance Agent ID `.ai` names on
BNB Chain. Each member's agent pays the dues from their own Agentic Wallet after the member says yes. The money sits in
a contract with no owner, and each round's pot can only go to the wallet that holds that round's `.ai` name.

> **Bahasa Indonesia.** Giliran adalah arisan antar nama `.ai` Binance Agent ID. Iuran dibayar agenmu dari Agentic
> Wallet setelah kamu bilang ya, uangnya ditahan kontrak tanpa pemilik, dan uang tiap putaran hanya bisa cair ke pemilik
> nama `.ai` yang dapat giliran. Riwayat bayar ikut namamu, jadi nggak bisa kabur lalu mulai dari nol.

| | |
|---|---|
| Contract | [`0x5D1050e1Be414c8798355fF727900a7d8bD0615b`](https://bscscan.com/address/0x5D1050e1Be414c8798355fF727900a7d8bD0615b) on BNB Chain, verified ([Sourcify exact match](https://repo.sourcify.dev/56/0x5D1050e1Be414c8798355fF727900a7d8bD0615b)) |
| Owner powers | [None](#owner-powers-none) |
| Site | [giliran-app.vercel.app](https://giliran-app.vercel.app): start a circle, invite links, live proof read from the contract |
| Agent skill | [`skills/giliran`](skills/giliran/SKILL.md), with a zero-dependency helper that builds every call |
| License | MIT |

## Try it

You need a `.ai` name (Binance app: Wallet, Agent ID), the Agentic Wallet with Developer Mode on, and a few USDT.

```bash
npx skills add binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet
npx skills add ariefdarmawant/giliran
```

Then tell your agent, in your own words or with the sentence the site writes for you:

> Buat arisan di giliran-app.vercel.app untuk rina.ai, dodi.ai, sari.ai. Iuran 10 USDT bulanan, dikocok.

Your agent creates the circle and gives you an invite link (`giliran-app.vercel.app/?c=<n>`) for your WhatsApp group. Each member
tells their agent "Ikut arisan Giliran #n." From then on each round needs only one thing from each member: one yes to
pay. The payment that completes a round pays it out in the same transaction.

## What Agent ID does here

In an arisan the organizer usually holds the money. In Giliran every member is a `.ai` name, and the contract keys
membership, payouts and payment history to it:

- Who can pay. Only the wallet holding a name can pay into its seat; `pay` checks `AgentID.ownerOf` on every payment.
- Who gets paid. Each round pays `ownerOf(recipient name)`, and nobody, the organizer included, can send it elsewhere.
- What they did before. Paid, missed and missed-after-receiving are written against the name (`recordOfName`). A
  `.ai` name is one per Binance user and can't be transferred, so a bad record can't be shed by switching wallets. The
  invite page shows every member's record before you join.

The site and the skill work only with names, never wallets. Creating a circle checks that every member name is a
claimed Agent ID (`claimed(name)` answers yes or no, nothing more).

## How a circle runs

| Who | Does | Call (their own Agentic Wallet, one yes each) |
|---|---|---|
| Organizer | creates the circle; takes no money | `createCircle(organizer, members, dues, period, joinBy, drawMode, guarantee)` |
| Every member | joins by paying the first dues before the join deadline; the last join pays out round 1 | an exact USDT `approve`, then `pay(circle, name)` |
| Every member | pays each round | `pay(circle, name)`. The payment that completes a round pays it out; the first payment after a deadline closes the overdue round. |
| Any member | opens a due round nobody has paid into since | `close(circle, round)` |
| Any member | ends a circle that didn't fill; every joiner is repaid | `cancel(circle)` |

Rounds pay out in list order or by draw. A drawn round's recipient comes from the hash of a block that did not exist
when the draw was started, and any later payment or close finishes the draw. Whoever's turn it is gets every member's
dues; Giliran takes no cut.

A payment counts for the oldest round the member hasn't paid while that round is open. Dues a member skipped before
their own turn are taken from their payout and sent to whoever was short, and every miss is recorded on the name. An
optional guarantee (off on the site) uses part of each payout to pay that member's next dues at once, so a member who
leaves after their turn has already paid them.

A circle has 3 to 25 members, dues of 0.01 to 100 USDT, rounds from 1 hour to 90 days, and a start at most 30 days ahead.

## Owner powers: none

Nothing can mint, set fees, pause, freeze, upgrade or withdraw members' money. USDT leaves the contract only as a round
payout to the recipient name's holder, as dues recovered for a member who was short, or as a refund to the wallets that
joined a circle that did not fill. `pay` pulls exactly one due, and only from the caller.

## Red lines

| Rule | How Giliran meets it |
|---|---|
| No web QR or pairing-code login | The site has no wallet connection and no login. Agents use their own Agentic Wallet session. |
| Skills never bypass confirmation | One yes per call, after the wallet's own preview. The skill never pays on a schedule and never skips the yes, even if asked. Reminders (a calendar file, a read-only inbox) only tell the user. |
| No unauthorized transfers | Every payment is the member's own `pay` call. Approvals are exact: the dues still owed in circles the member joined, recomputed each time. |
| Open source, owner permissions disclosed | MIT, verified, no owner. |
| No Binance impersonation | The name is Giliran, the domain giliran-app.vercel.app. |
| No credential collection | Nothing asks for seed phrases, keys, API secrets or pairing codes; the skill refuses them. |
| No promised returns; risk shown | An arisan returns members' own money. No yield wording; a risk line sits beside the copy button. |
| Agent ID is not a wallet lookup | The site and the skill never show which wallet holds a name. No contract view returns a member's wallet. |

## Repository

| Path | What |
|---|---|
| [`contracts/`](contracts) | `Giliran.sol` (one contract for every circle), Foundry tests, deploy script, `deployments/56.json` |
| [`skills/giliran/`](skills/giliran) | The agent skill and its helper (`scripts/giliran.mjs`, no dependencies, never signs) |
| [`site/`](site) | The static site: composer, invite pages, proof page. English and Indonesian. Reads BNB Chain directly. |
| [`tests/site/`](tests/site) | Browser tests against a mock BNB Chain RPC |
| [`docs/`](docs) | [`DEPLOY.md`](docs/DEPLOY.md): how the contract was deployed and verified, and how to point the site and skill at it |

## Tests

```bash
cd contracts && forge test                                                     # 83 unit, fuzz and invariant
FORK_TESTS=1 forge test --match-path test/Circle.fork.t.sol                     # 3 on BSC mainnet state
node --test skills/giliran/scripts/giliran.test.mjs                             # 43 helper
FORK_E2E=1 node --test skills/giliran/scripts/e2e.fork.test.mjs                 # 2 end to end on a fork
node tests/site/invite.test.mjs                                                 # site (also composer, proof, calendar)
```

The fork tests use real USDT, the real Agent ID registry and BSC's block hash history. The end-to-end runs send every
transaction the helper builds from members' own keys: a drawn circle with a guarantee from creation to its first payout,
and a circle that never fills, cancelled and refunded.

## Known limits

As in any arisan, a member who has received can stop paying. The contract can't prevent it; every miss stays on their
name for good, so start circles with people whose record you have checked.

Members need Developer Mode on, as Agentic Wallet contract calls require.

## License

MIT, see [`LICENSE`](LICENSE).
