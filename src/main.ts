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
    'For linking sites once the infrastructure pivots have gone cold. A domain is re-registered, a host moves behind a CDN, a certificate is reissued, but a monetisation account is where money arrives and costs identity documents and a payout history to replace. Sites that share a publisher ID, analytics property or payment account often stay linked after their infrastructure no longer is.',
    '',
    '**Who sees it:** the target, directly: the selected hosts and wherever they redirect see the analyst\'s address. With "Follow tag-manager containers" on, Google (www.googletagmanager.com) also receives each container ID with the analyst\'s address; the target does not see that request.',
    '',
    '**Read results with care:**',
    '',
    '- **Fan-out.** An identifier already on 15 or more edges (analytics, tag-manager and site-verification IDs) or 40 or more (ad, affiliate, payment and other accounts) is likelier an agency account or a CMS default than a shared operator; the run summary names it.',
    "- **Who put it there.** ads.txt and the /.well-known/ files sit at fixed paths on the host's own document root, so the operator put them there. A script tag in a page may have been injected by a third party.",
    '- **Unknown is not absent.** Scripts are not run, so identifiers injected at runtime are missed, beyond what a Google Tag Manager container holds. Challenge pages, documents cut at 2 MB and unreachable hosts are reported apart from "no identifiers". A bare IP reaches only the server\'s default virtual host.',
    '',
    '**Source:** https://github.com/Vineyard-Intelligence/pluginpack-ad-tags (Apache-2.0)',

].join('\n');

export default definePluginPack({
    identifier: 'run.vineyard.pluginpacks.ad_tags',
    content_type: 'vineyard:pluginpack',
    name: 'Ad Tags',
    version: '1.3.1',
    summary:
        "Extracts advertising, analytics, affiliate and payment account identifiers from a site's markup and from its ads.txt and /.well-known/ files. Desktop only.",
    description: DESCRIPTION,
    plugins: [adTags, publisherFilesExtract],
});
