// Ad Tags pack — reads a page's markup and pulls out the third-party account identifiers in it:
// ad-network publisher IDs, analytics properties, tag-manager containers, affiliate codes and
// payment accounts.
//
// WHY THIS PACK EXISTS. Infrastructure signals go cold. A domain is re-registered, a host moves
// behind a CDN, a certificate is reissued — an operator does all three far more readily than they
// re-open a monetisation account, because the account is where the money arrives and re-opening it
// costs identity documents and a payout history. So a shared publisher ID outlives the pivots that
// stop working, which is exactly when it is needed.
//
// WHY DESKTOP. The target is whatever host the analyst selected, which cannot be a fixed `network`
// allowlist entry, and almost no site sends CORS headers for its own HTML. ctx.net.probe reaches
// it from the Electron main process, anonymously and SSRF-guarded. In the web build these plugins
// say so and stop rather than half-working.
import { definePluginPack } from './sdk';
import { adTags } from './ad-tags';
import { publisherFilesExtract } from './publisher-files';

// The pack's page in the marketplace drawer, in Markdown. One entry per line so that backticks and
// quotes in the Markdown need no template-literal escaping.
const DESCRIPTION = [
    'Ad Tags reads what a site serves and turns the third-party account identifiers in it into graph nodes: ad-network publisher and zone IDs, analytics properties, tag-manager containers, affiliate codes, payment accounts and app-association identifiers. Infrastructure changes easily: a domain is re-registered, a host moves behind a CDN, a certificate is reissued. A monetisation account is where money arrives, and replacing it costs identity documents and a payout history, so two sites carrying the same account often stay linked after the infrastructure pivots have gone cold.',
    '',
    'Both plugins run only in the Vineyard desktop app. Sites do not send CORS headers for their own HTML, so the web app cannot read it; there the plugins stop with a message.',
    '',
    '## Plugins',
    '',
    '### Ad Tag Extract',
    '',
    '- **Runs on:** URL, Domain and IP Address nodes.',
    '- **Adds:** one Tracking ID node per identifier, linked from the selected node by "carries tracking ID". A PayPal recipient address (`business=` in a PayPal link or form) becomes an Email Address node linked by "pays".',
    '- **What it fetches:** a URL as given; for a Domain or IP, `https://` and `http://` on the host; for a Domain, by default also its `www.` or bare counterpart. Redirects are followed by hand, up to five, including to other hosts, and the URL the page finally came from is recorded as `observed_on`. Identical pages from two addresses of one selected node are scanned once.',
    '- **Option "Follow tag-manager containers"** (on by default): also fetches up to four Google Tag Manager containers the page references and extracts the Google Ads, AdSense, Analytics, Google tag and GTM IDs they would inject at runtime. These are attributed to the page.',
    '- **Option "Also try the www / apex host"** (on by default): the `www.` toggle above. No effect on URLs or IPs.',
    '- **Option "Also try HTTP on 443 and HTTPS on 80"** (off by default): four requests per host instead of two. A server that answers with the nginx "plain HTTP request was sent to HTTPS port" error is logged as a fingerprint, not parsed.',
    '',
    '### Publisher Files Extract',
    '',
    '- **Runs on:** Domain and URL nodes (for a URL, its host).',
    '- **What it fetches:** over HTTPS, `/ads.txt`, `/app-ads.txt`, `/.well-known/assetlinks.json`, `/.well-known/microsoft-identity-association.json` and `/.well-known/apple-app-site-association`.',
    '- **Adds:** Tracking ID nodes linked by "carries tracking ID": from ads.txt and app-ads.txt the Google publisher ID on DIRECT lines, `OWNERDOMAIN` and `INVENTORYPARTNERDOMAIN`; Android package names and signing-certificate SHA-256 fingerprints; Apple team IDs; Microsoft Entra application IDs.',
    '- **Option "Extract every DIRECT account"** (off by default): also takes every other ad system\'s DIRECT account. This is voluminous: the source records 7,334 nodes from 88 publisher hosts, a median of 74 per file, most of them exchange relationships shared with thousands of unrelated publishers.',
    '- A path that answers with an HTML page (a site that returns its app shell for every path) counts as absent.',
    '',
    "These files sit at fixed paths on the host's own document root, so their content was put there by the operator. A script tag in a page only shows that some tag reached the page, possibly injected by a third party.",
    '',
    '## What it recognises',
    '',
    '121 collectors, one per markup shape rather than per provider. The source states that each was measured against a corpus of live pages, ads.txt files, tag-manager containers and /.well-known/ documents, and against a negative corpus that includes minified libraries.',
    '',
    '| Kind | Providers |',
    '| --- | --- |',
    '| advertising | AdSense, Google Ads, Google Ad Manager, Criteo, ExoClick, JuicyAds, PropellerAds (Monetag), Adsterra, PopAds, PopCash, TrafficStars, PlugRush, AdMaven, ClickAdilla, RichAds, Kakao AdFit, WiderPlanet; Meta, TikTok, X (Twitter), LinkedIn, Reddit, Snapchat and Kakao pixels |',
    '| analytics | Google Analytics (GA4 and UA), Yandex Metrica, Baidu Tongji, 51.la, Microsoft Clarity, Hotjar, Histats, StatCounter, Matomo, Plausible, Umami, Naver Analytics, Beusable |',
    '| tag_manager | Google Tag Manager, Google tag, OneTag (onetag.co.kr) |',
    '| affiliate | Amazon Associates, Awin, ClickBank, Impact, ShareASale, Coupang Partners, Tenping |',
    '| site_verification | Bing Webmaster Tools, Naver Search Advisor |',
    '| payment | PayPal (recipient address, merchant ID, hosted button ID, SDK client ID), Stripe live publishable keys, Ko-fi, Patreon; cryptocurrency payment URIs (bitcoin, bitcoincash, ethereum, litecoin, dogecoin, monero) and bare Bitcoin bech32 and Monero addresses |',
    '| other | ads.txt OWNERDOMAIN and INVENTORYPARTNERDOMAIN, Android package and signing certificate, Apple team ID, Microsoft Entra application ID |',
    '',
    'A Tracking ID node carries `value` (the identifier exactly as the page has it), `provider`, `kind`, `source` (inline script, script src, meta tag, link, ads.txt, well-known file or tag-manager container), `observed_on` (the URL the bytes came from, after redirects) and `first_seen`. The edge carries the collector key, the source and `observed_on`.',
    '',
    '## Identity and merging',
    '',
    "A Tracking ID is identified by provider and value together. Many networks issue bare five-to-nine digit numbers, so an ExoClick zone and another network's zone with the same digits stay separate. Before creating a node the plugins look for an existing one with the same provider and value (or the same email address) and link to it instead, so sites that share an account converge on one node, including within a single run. Issuers that appear under two names are folded into one provider: Monetag into PropellerAds, Google's ads.txt `pub-` into AdSense `ca-pub-`, and several ads.txt vendor-domain pairs. Vendor demo accounts, placeholders and known hub values are rejected.",
    '',
    '## Reading the results',
    '',
    '- **Fan-out.** When a reused identifier already has 15 or more edges (analytics, tag-manager and site-verification IDs) or 40 or more (advertising, affiliate, payment and other accounts), the run summary names it: at that fan-out a shared agency account or a CMS default is likelier than a shared operator. The edge is still created.',
    '- **Unknown is not absent.** Ad Tag Extract reports bot-challenge pages (Cloudflare, DDoS-Guard, HTTP 403 or 503), documents cut at the 2 MB limit and unreachable addresses separately in the run summary rather than as "no identifiers". Publisher Files Extract does the same for challenge pages.',
    '- **Static text only.** Pages are scanned as text and their scripts are not run, so identifiers injected at runtime by other scripts are missed. The tag-manager option recovers what a Google Tag Manager container would inject.',
    "- **Bare IPs.** A request to an IP address reaches only the server's default virtual host; name-based sites on the same address are not seen.",
    '',
    '## Requirements',
    '',
    '- Vineyard desktop app.',
    '- Type packs: `run.vineyard.typepacks.infrastructure` 2.4.0 or later (Tracking ID with a free-text provider) and `run.vineyard.typepacks.identity` (Email Address).',
    '- No API key or account.',
    '',
    '## What it contacts',
    '',
    "- **The target, directly.** This is active collection: requests go from the analyst's machine to the selected hosts and to wherever they redirect, and those servers see the analyst's address. Ad Tag Extract sends two requests per host by default (four with the cross-protocol option), for the host and, for a Domain, its `www.` or bare counterpart. Publisher Files Extract sends five HTTPS requests per host. Each request has a 15-second timeout and reads at most 2 MB.",
    '- **www.googletagmanager.com**, when "Follow tag-manager containers" is on: Google receives the container ID together with the analyst\'s address. The target does not see this request.',
    '- No other service, and no Vineyard-operated service.',
    '',
    '## Data and licences',
    '',
    'No third-party dataset is bundled. The collector table and its test fixtures are part of this repository.',
    '',
    '## Source',
    '',
    'https://github.com/Vineyard-Intelligence/pluginpack-ad-tags (Apache-2.0)',
    '',
    '`node build.mjs` rebuilds `dist/pack.mjs` and the manifest from `src/` with a pinned esbuild. `npm run selftest` checks the collector table and runs 83 committed fixtures: excerpts of live pages, plus slices of minified libraries that must yield nothing.',

].join('\n');

export default definePluginPack({
    identifier: 'run.vineyard.pluginpacks.ad_tags',
    content_type: 'vineyard:pluginpack',
    name: 'Ad Tags',
    version: '1.3.0',
    summary:
        "Extracts advertising, analytics, affiliate and payment account identifiers from a site's markup and from its ads.txt and /.well-known/ files. Desktop only.",
    description: DESCRIPTION,
    plugins: [adTags, publisherFilesExtract],
});
