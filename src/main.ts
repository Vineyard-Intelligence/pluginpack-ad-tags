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
    'For linking sites after infrastructure pivots go cold: a domain, host or certificate is easily replaced, but a monetisation account costs identity documents and a payout history, so sites sharing a publisher ID, analytics property or payment account often stay linked.',
    '',
    '**Who sees it:** the selected hosts and wherever they redirect see the analyst\'s address. With "Follow tag-manager containers" on, Google (www.googletagmanager.com) also receives each container ID; the target does not see it.',
    '',
    '**Read results with care:**',
    '',
    '- An identifier on 15 or more edges (analytics, tag-manager, site-verification) or 40 or more (ad, affiliate, payment and other accounts) is likelier an agency account or a CMS default than one operator; the run names it.',
    '- A `bitcoin:` or similar link, or a bare bc1 or Monero address, names its network; an `ethereum:` link only with a chain id, otherwise its address is on an unstated EVM chain. In a token transfer link the payee is the address, not the token contract.',
    "- ads.txt and /.well-known/ files sit on the host's own document root, so the operator put them there; a script tag may be a third party's injection.",
    '- Scripts are not run, so identifiers injected at runtime are missed beyond what a tag-manager container holds. Challenge pages, pages cut at 2 MB and unreachable hosts are reported apart from "no identifiers", and a bare IP reaches only the server\'s default site.',
    '',
    '**Source:** https://github.com/Vineyard-Intelligence/pluginpack-ad-tags (Apache-2.0)',

].join('\n');

export default definePluginPack({
    identifier: 'run.vineyard.pluginpacks.ad_tags',
    content_type: 'vineyard:pluginpack',
    name: 'Ad Tags',
    version: '1.4.0',
    summary:
        "Extracts advertising, analytics, affiliate and payment account identifiers from a site's markup and from its ads.txt and /.well-known/ files. Desktop only.",
    description: DESCRIPTION,
    plugins: [adTags, publisherFilesExtract],
});
