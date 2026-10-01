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

export default definePluginPack({
    identifier: 'run.vineyard.pluginpacks.ad_tags',
    content_type: 'vineyard:pluginpack',
    name: 'Ad Tags',
    version: '1.1.0',
    description:
        "Extracts advertising, analytics, affiliate and payment account identifiers from a site's markup and from its ads.txt and /.well-known/ files. Desktop only.",
    plugins: [adTags, publisherFilesExtract],
});
