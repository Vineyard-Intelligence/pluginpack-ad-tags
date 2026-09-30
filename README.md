# pluginpack-ad-tags

Extracts advertising, analytics, affiliate and payment **account identifiers** from a page, and
from the files a publisher authors about itself.

Two plugins:

- **Ad Tag Extract** — probes a selected `web.url`, `infrastructure.domain` or
  `infrastructure.ip_address`, reads the served markup, and emits the account identifiers in it.
  Optionally follows the page's tag-manager container, which recovers identifiers the markup does
  not contain.
- **Ownership Files** — fetches `/ads.txt`, `/app-ads.txt` and `/.well-known/*`. These sit at fixed
  paths on the host's own document root and cannot be injected by a third party, so an account
  declared there is the operator's own claim.

Desktop only: sites do not send CORS headers for their own HTML, so the browser cannot read it.

## Why account identifiers

Infrastructure goes cold. A domain is re-registered, a host moves behind a CDN, a certificate is
reissued — an operator does all three far more readily than they re-open a monetisation account,
because that is where money arrives and re-opening it costs identity documents and a payout
history. A shared publisher ID outlives the pivots that stop working.

## The collector table

121 collectors, one per markup **shape** rather than per provider.

Values are namespaced `provider:identifier`. Half these networks issue a bare five-to-nine digit
integer, and `web.tracking_id` identity is the value alone, so an un-namespaced `4823917` would
merge one operator's ad zone with an unrelated operator's.

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
