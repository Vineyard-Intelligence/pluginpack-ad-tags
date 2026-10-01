// Ad Tag Extract — probe the selected URL / domain / IP, read the markup, emit the account
// identifiers in it.
import { definePlugin } from './sdk';
import type { HostContext, RunResult, GraphNode } from './sdk';
import { COLLECTORS } from './collectors';
import { scan, containerIds } from './scan';
import type { Hit } from './scan';
import { emitHit, newTally } from './emit';
import { fetchPage, candidateUrls, bodyKey, isChallenge, isProtocolMismatch, MAX_BODY_BYTES } from './fetch';

type Seed = { id: string; kind: 'url' | 'domain' | 'ip'; value: string };

function readSeed(n: GraphNode): Seed | null {
    const d = (n.data ?? {}) as Record<string, unknown>;
    const s = (k: string) => (typeof d[k] === 'string' ? (d[k] as string).trim() : '');
    if (n.type === 'web.url' && s('url')) return { id: String(n.id), kind: 'url', value: s('url') };
    if (n.type === 'infrastructure.domain' && s('domain_name')) return { id: String(n.id), kind: 'domain', value: s('domain_name') };
    if (n.type === 'infrastructure.ip_address' && s('ip_address')) return { id: String(n.id), kind: 'ip', value: s('ip_address') };
    return null;
}

export const adTags = definePlugin({
    manifest: {
        identifier: 'run.vineyard.plugins.ad_tags',
        content_type: 'vineyard:plugin',
        name: 'Ad Tag Extract',
        version: '1.1.0',
        description:
            'Fetches each selected URL, Domain or IP Address and extracts the advertising, analytics, tag-manager, site-verification, affiliate and payment account identifiers in its markup as Tracking ID nodes linked by "carries tracking ID"; PayPal recipient addresses become Email Address nodes linked by "pays". By default also reads the Google Tag Manager containers the page references. Desktop only.',
        icon: 'megaphone',
        author: { name: 'VINEYARD', url: 'https://vineyard.run' },
        license: 'Apache-2.0',
        platforms: {
            primary: 'desktop',
            web: { runtime: 'sandbox-js', entry: 'inline' },
            desktop: { runtime: 'sandbox-js', entry: 'inline', min_app_version: '0.1.0' },
        },
        io: {
            consumes: [
                { typepack: 'run.vineyard.typepacks.infrastructure', category: 'web', name: 'url' },
                { typepack: 'run.vineyard.typepacks.infrastructure', category: 'infrastructure', name: 'domain' },
                { typepack: 'run.vineyard.typepacks.infrastructure', category: 'infrastructure', name: 'ip_address' },
            ],
            produces: [
                { typepack: 'run.vineyard.typepacks.infrastructure', category: 'web', name: 'tracking_id' },
                { typepack: 'run.vineyard.typepacks.identity', category: 'identity', name: 'email_address' },
            ],
        },
        params: {
            type: 'object',
            properties: {
                follow_tag_manager: {
                    type: 'boolean',
                    title: 'Follow tag-manager containers',
                    default: true,
                    description:
                        "Fetches googletagmanager.com/gtm.js for each container the page names, as static text. This is the only way to see identifiers a tag manager would have injected at runtime \u2014 the sandbox does not execute JavaScript \u2014 and it recovers Google Ads and AdSense accounts that are provably absent from the markup. One request to Google per container, carrying your address and the container ID, so Google learns the container was looked up. The site under investigation does not.",
                },
                try_www: {
                    type: 'boolean',
                    title: 'Also try the www / apex twin',
                    default: true,
                    description:
                        'For a domain or IP seed, fetch both the bare host and its www counterpart. They are frequently different pages: in measurement one apex served a live payment key in 657KB of markup while its www twin served 197KB with none, at the same moment.',
                },
                cross_protocol: {
                    type: 'boolean',
                    title: 'Cross HTTP and HTTPS against ports 80 and 443',
                    default: false,
                    description:
                        'Adds http://host:443 and https://host:80 to the two ordinary combinations. Worth it against a misconfigured server \u2014 some answer plain HTTP on the TLS port with a normal page \u2014 but usually those two return a protocol error rather than markup, so it doubles the requests to find something rare.',
                },
            },
        },
        scopes: {
            graph: ['node:read', 'node:create', 'edge:create'],
            web_probe: {
                purpose:
                    'Fetch the selected site’s markup, and optionally its tag-manager container, to read the account identifiers embedded in it. Anonymous, cookie-less, SSRF-guarded, desktop only.',
            },
        },
        lifecycle: { persistence: 'opt-in', controls: ['progress', 'cancel'], progress: 'determinate' },
    },

    async run(ctx: HostContext): Promise<RunResult> {
        const ids = ctx.input.selection;
        if (!ids.length) return { summary: 'Select a URL, domain or IP node first', counts: { created: 0 } };
        if (!ctx.net?.probe) {
            return {
                summary:
                    'Ad tag extraction needs the desktop shell: the target is whatever host you selected, so it cannot be a fixed network allowlist entry, and sites do not send CORS headers for their own HTML. Run this in the desktop app.',
                counts: { created: 0 },
            };
        }

        const followGtm = ctx.params?.follow_tag_manager !== false;
        const tryWww = ctx.params?.try_www !== false;
        const crossProtocol = ctx.params?.cross_protocol === true;
        const firstSeen = new Date().toISOString();

        const tally = newTally();
        let scanned = 0;
        let unreachable = 0;
        let challenged = 0;
        let mismatched = 0;
        let truncated = 0;
        let containers = 0;
        let skipped = 0;
        const brokenCollectors = new Set<string>();

        for (let i = 0; i < ids.length; i++) {
            if (ctx.signal?.aborted) break;
            const node = await ctx.graph!.get!(ids[i]);
            const seed = node ? readSeed(node) : null;
            if (!seed) {
                skipped++;
                continue;
            }

            ctx.progress?.set?.({
                percent: Math.round((100 * i) / ids.length),
                message: `Reading ${seed.value} (${i + 1}/${ids.length})`,
            });

            const targets = candidateUrls(seed.kind, seed.value, { crossProtocol, tryWww });
            const seenBodies = new Set<string>();
            let anyMarkup = false;

            for (const target of targets) {
                if (ctx.signal?.aborted) break;
                const page = await fetchPage(ctx, target, MAX_BODY_BYTES);

                if (isProtocolMismatch(page)) {
                    // Not a page. The server told us the port speaks TLS — a fingerprint, and the
                    // reason the cross-protocol option exists at all, but nothing to parse.
                    mismatched++;
                    ctx.progress?.log?.(`${target}: HTTP on a TLS port (server said so) — no markup`);
                    continue;
                }
                if (page.error || page.status === 0 || !page.body) {
                    unreachable++;
                    continue;
                }
                if (isChallenge(page)) {
                    // An interstitial is not an absence of identifiers, and reporting it as one
                    // would be a false negative dressed as a clean result.
                    challenged++;
                    ctx.progress?.log?.(`${target}: bot challenge (${page.status}) — identifiers unknown, not absent`);
                    continue;
                }
                if (page.truncated) truncated++;

                const key = bodyKey(page.body);
                if (seenBodies.has(key)) continue; // www and apex served the same bytes
                seenBodies.add(key);
                anyMarkup = true;
                scanned++;

                const res = scan(page.body, 'markup', COLLECTORS);
                res.broken.forEach((k) => brokenCollectors.add(k));
                for (const hit of res.hits) await emitHit(ctx, seed.id, page.url, hit, firstSeen, tally);

                if (followGtm) {
                    for (const cid of containerIds(page.body)) {
                        if (ctx.signal?.aborted) break;
                        const c = await fetchPage(ctx, `https://www.googletagmanager.com/gtm.js?id=${cid}`, MAX_BODY_BYTES);
                        if (c.error || c.status !== 200 || !c.body) continue;
                        containers++;
                        if (c.truncated) truncated++;
                        const gres = scan(c.body, 'gtm', COLLECTORS);
                        gres.broken.forEach((k) => brokenCollectors.add(k));
                        // Attributed to the PAGE, not to the container: the page is what carries
                        // the container, and the identifier is the page operator's either way.
                        for (const hit of gres.hits) await emitHit(ctx, seed.id, page.url, hit, firstSeen, tally);
                    }
                }
            }

            if (!anyMarkup) ctx.progress?.log?.(`${seed.value}: no readable markup from ${targets.length} attempt(s)`);
        }

        return { summary: summarize(tally, { scanned, unreachable, challenged, mismatched, truncated, containers, skipped, brokenCollectors }), counts: { created: tally.created, reused: tally.reused, pages: scanned, containers, challenged, unreachable } };
    },
});

function summarize(
    tally: { created: number; reused: number; hubs: Array<{ value: string; edges: number; kind: string }> },
    s: { scanned: number; unreachable: number; challenged: number; mismatched: number; truncated: number; containers: number; skipped: number; brokenCollectors: Set<string> },
): string {
    const total = tally.created + tally.reused;
    const parts: string[] = [
        total === 0
            ? `No identifiers found in ${s.scanned} page(s)`
            : `${total} identifier(s) from ${s.scanned} page(s) — ${tally.created} new, ${tally.reused} already in the graph`,
    ];
    if (s.containers) parts.push(`${s.containers} tag-manager container(s) followed`);
    // These four are stated even at zero-adjacent counts because each one is a case where the
    // honest answer is "unknown", and folding them into the headline count would read as "absent".
    if (s.challenged) parts.push(`${s.challenged} blocked by a bot challenge (identifiers unknown, not absent)`);
    if (s.truncated) parts.push(`${s.truncated} document(s) hit the 2MB cap — anything past it was not read`);
    if (s.unreachable) parts.push(`${s.unreachable} address(es) unreachable`);
    if (s.mismatched) parts.push(`${s.mismatched} port(s) answered with a protocol error`);
    if (s.skipped) parts.push(`${s.skipped} selected node(s) were not a URL, domain or IP`);
    if (tally.hubs.length) {
        const worst = tally.hubs.sort((a, b) => b.edges - a.edges)[0];
        parts.push(
            `${tally.hubs.length} identifier(s) are already linked to many sites — ${worst.value} has ${worst.edges}. At that fan-out a shared marketing account or a CMS default is likelier than a shared operator; treat those edges as weak`,
        );
    }
    if (s.brokenCollectors.size) parts.push(`${s.brokenCollectors.size} collector(s) failed to compile: ${[...s.brokenCollectors].join(', ')}`);
    return parts.join('. ') + '.';
}
