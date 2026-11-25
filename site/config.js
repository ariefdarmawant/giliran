// Filled from contracts/deployments/56.json at deploy time. Empty `giliran` = not deployed yet:
// the hero shows the sample circle and says so.
window.GILIRAN_CONFIG = {
  chainId: 56,
  // Public BNB Chain endpoints from six operators, each checked on 2026-11-25 for chain 56, browser access (CORS),
  // batched calls and under a second to answer. No keys: the browser calls them directly.
  rpc: [
    'https://bsc-dataseed.bnbchain.org',
    'https://bsc-rpc.publicnode.com',
    'https://bsc-dataseed1.defibit.io',
    'https://bsc-dataseed1.ninicoin.io',
    'https://bsc-mainnet.public.blastapi.io',
    'https://bsc.meowrpc.com',
  ],
  // eth_getLogs over 50,000-block windows: of the endpoints checked, only publicnode serves it.
  logRpc: ['https://bsc-rpc.publicnode.com', 'https://bsc.publicnode.com'],
  giliran: '0x5D1050e1Be414c8798355fF727900a7d8bD0615b',
  fromBlock: 135617358, // the contract's deploy block: the proof page reads its events from here
  explorer: 'https://bscscan.com',
  repo: 'https://github.com/ariefdarmawant/giliran', // the source, linked in the footer
  skill: 'npx skills add ariefdarmawant/giliran', // how an agent installs the Giliran skill
  site: 'giliran-app.vercel.app',
};

// Each visit starts at a random endpoint and falls back through the rest in order, so traffic spreads across them.
for (const k of ['rpc', 'logRpc']) {
  const list = window.GILIRAN_CONFIG[k];
  const start = Math.floor(Math.random() * list.length);
  window.GILIRAN_CONFIG[k] = [...list.slice(start), ...list.slice(0, start)];
}
