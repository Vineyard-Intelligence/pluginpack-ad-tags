# pluginpack-ad-tags

Extracts advertising, analytics, affiliate and payment **account identifiers** from a page, and
from the files a publisher authors about itself.

Two plugins:

- **Ad Tag Extract** (`run.vineyard.plugins.ad_tags`) — fetches a selected `web.url`,
  `infrastructure.domain` or `infrastructure.ip_address` and extracts the account identifiers in its
  markup. By default also reads the Google Tag Manager containers the page references.
- **Publisher Files Extract** (`run.vineyard.plugins.publisher_files_extract`) — fetches
  `/ads.txt`, `/app-ads.txt` and the `/.well-known/` app-association files and extracts the
  identifiers declared in them.

Desktop only: sites do not send CORS headers for their own HTML, so the browser cannot read it.

## Why account identifiers

Infrastructure goes cold. A domain is re-registered, a host moves behind a CDN, a certificate is
reissued — an operator does all three far more readily than they re-open a monetisation account,
because that is where money arrives and re-opening it costs identity documents and a payout
history. A shared publisher ID outlives the pivots that stop working.

## The collector table

122 collectors, one per markup **shape** rather than per provider.

Each node holds the identifier exactly as the page carries it (`G-SXM8TFRYSW`, `4823917`) with
the issuer in `provider`. `web.tracking_id` identity is the pair: half these networks issue a bare
five-to-nine digit integer, so `4823917` alone would merge one operator's ad zone with an
unrelated operator's.

Cryptocurrency payment addresses are the exception: they become `cryptocurrency.crypto_address`
nodes (identity `network` + `address`), linked from the page by `accepts payment to`. A
`web.tracking_id` folds its value to lower case, which would merge Base58 wallets (Monero, legacy
Bitcoin, Litecoin, Dogecoin) that differ by case alone. The network comes from the link's scheme
(`bitcoin:`, `bitcoincash:`, `litecoin:`, `dogecoin:`, `monero:`) or the bare format (`bc1…`, a
Monero address); an EIP-681 `ethereum:` request names one only with a decimal `@<chain_id>`
(1 ethereum, 56 bsc, 137 polygon, …) and is `evm` without it (`@0x38`, hex, counts as none). For `ethereum:<token>/transfer?address=<payee>`
the payee is the `address` parameter, and the token contract and chain id go on the edge. Addresses
are written in the type pack's canonical form (EVM and bech32 in lower case, a Bitcoin Cash legacy
address as CashAddr, a Litecoin `3…` as `M…`), and one that fails its own checksum is dropped.

A project has one link per pair of nodes, so when the seed is already linked to a node the run
finds, Ad Tag Extract keeps that link's label (an analyst's "donation wallet", say) and only adds
its data, instead of proposing a relabel on every run. Reading those links, and counting how many
sites already share an identifier, is why it asks for `edge:read`.

## Checks

```
npm run build       # bundle + manifest + selftest
npm run selftest    # structural checks + 83 committed fixtures
npm run fixtures -- <corpus-dir> <out>   # regenerate fixtures from a corpus
```

`src/corpusrun.ts` runs the whole table over a corpus directory and reports per-collector hit
counts, distinct values and negative-corpus leaks. Dev only; not bundled.

## Requires

`run.vineyard.typepacks.infrastructure` >= 2.4.0 (free-text `provider`, `payment_recipient` edge),
`run.vineyard.typepacks.identity` (PayPal's `business=` address becomes an
`identity.email_address`, where it converges with WHOIS contacts and breach data instead of sitting
in a tracking-ID silo) and `run.vineyard.typepacks.cryptocurrency` (payment addresses). A project
without the last refuses the address nodes; the run counts them and says to install it.
