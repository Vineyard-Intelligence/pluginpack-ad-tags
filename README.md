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

121 collectors, one per markup **shape** rather than per provider.

Each node holds the identifier exactly as the page carries it (`G-SXM8TFRYSW`, `4823917`) with
the issuer in `provider`. `web.tracking_id` identity is the pair: half these networks issue a bare
five-to-nine digit integer, so `4823917` alone would merge one operator's ad zone with an
unrelated operator's.

## Checks

```
npm run build       # bundle + manifest + selftest
npm run selftest    # structural checks + 83 committed fixtures
npm run fixtures -- <corpus-dir> <out>   # regenerate fixtures from a corpus
```

`src/corpusrun.ts` runs the whole table over a corpus directory and reports per-collector hit
counts, distinct values and negative-corpus leaks. Dev only; not bundled.

## Requires

`run.vineyard.typepacks.infrastructure` >= 2.4.0 (free-text `provider`, `payment_recipient` edge)
and `run.vineyard.typepacks.identity` (PayPal's `business=` address becomes an
`identity.email_address`, where it converges with WHOIS contacts and breach data instead of sitting
in a tracking-ID silo).
