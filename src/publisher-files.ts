// Publisher Files Extract — read the documents a publisher authors ABOUT ITSELF and pull the account
// identifiers out of them.
//
// This is a different class of evidence from the page-markup plugin, and stronger. An inline
// script tag proves only that some tag reached the page; a third party could have injected it, and
// on an ad-supported site somebody usually did. These files cannot be injected: /ads.txt,
// /app-ads.txt and /.well-known/* are served from fixed paths on the host's own document root, so
// whatever is in them the operator put there. `ads.txt` says in the IAB spec that a DIRECT line
// means the publisher is the direct account holder at that ad system, and `assetlinks.json`
// carries an APK signing-key fingerprint, which survives a package rename and a store takedown
// because it is cryptographic rather than nominal.
//
// The measured trade-off, on adult and piracy hosts specifically: assetlinks answered on 1 of 10,
// microsoft-identity-association on 2 of 13, and ads.txt on 0 of 15. So the hit rate is low, the
// requests are cheap and static, and when one does answer it is the best thing in the project. That
// is why this is a separate plugin rather than four more fetches bolted onto the page scan — it is
// worth running on its own, against a whole selection, and worth NOT running when the analyst only
// wants the markup.
import { definePlugin } from './sdk';
import type { HostContext, RunResult, GraphNode } from './sdk';
import { COLLECTORS } from './collectors';
import { scan } from './scan';
import { emitHit, newTally } from './emit';
import { fetchPage, isChallenge, MAX_BODY_BYTES } from './fetch';
import type { HitPhase } from './collectors';

/** path -> which collector phase parses it. Order is yield-descending; all four are cheap. */
const FILES: Array<{ path: string; phase: HitPhase }> = [
    { path: '/ads.txt', phase: 'adstxt' },
    { path: '/app-ads.txt', phase: 'adstxt' },
    { path: '/.well-known/assetlinks.json', phase: 'wellknown' },
    { path: '/.well-known/microsoft-identity-association.json', phase: 'wellknown' },
    { path: '/.well-known/apple-app-site-association', phase: 'wellknown' },
];

/** ads.txt is capped hard: a large publisher's file is legitimately over a megabyte. */
const MAX_FILE_BYTES = MAX_BODY_BYTES;

function hostOf(n: GraphNode): { id: string; host: string } | null {
    const d = (n.data ?? {}) as Record<string, unknown>;
    const s = (k: string) => (typeof d[k] === 'string' ? (d[k] as string).trim() : '');
    if (n.type === 'infrastructure.domain' && s('domain_name')) return { id: String(n.id), host: s('domain_name') };
    if (n.type === 'web.url' && s('url')) {
        try {
            return { id: String(n.id), host: new URL(s('url')).hostname };
        } catch {
            return null;
        }
    }
    return null;
}

export const publisherFilesExtract = definePlugin({
    manifest: {
        identifier: 'run.vineyard.plugins.publisher_files_extract',
        content_type: 'vineyard:plugin',
        name: 'Publisher Files Extract',
        version: '1.1.0',
        description:
            'Fetches /ads.txt, /app-ads.txt and the /.well-known/ app-association files from the host of each selected Domain or URL and extracts the identifiers declared in them (ads.txt accounts, Android package names and signing-certificate fingerprints, Apple team IDs, Microsoft Entra application IDs) as Tracking ID nodes linked by "carries tracking ID". From ads.txt it takes the Google publisher ID, OWNERDOMAIN and INVENTORYPARTNERDOMAIN, plus every other DIRECT account when all_ad_systems is on. Desktop only.',
        icon: 'file-badge',
        author: { name: 'VINEYARD', url: 'https://vineyard.run' },
        license: 'Apache-2.0',
        platforms: {
            primary: 'desktop',
            web: { runtime: 'sandbox-js', entry: 'inline' },
            desktop: { runtime: 'sandbox-js', entry: 'inline', min_app_version: '0.1.0' },
        },
        io: {
            consumes: [
                { typepack: 'run.vineyard.typepacks.infrastructure', category: 'infrastructure', name: 'domain' },
                { typepack: 'run.vineyard.typepacks.infrastructure', category: 'web', name: 'url' },
            ],
            produces: [{ typepack: 'run.vineyard.typepacks.infrastructure', category: 'web', name: 'tracking_id' }],
        },
        params: {
            type: 'object',
            properties: {
                all_ad_systems: {
                    type: 'boolean',
                    title: 'Extract every DIRECT account in ads.txt, not just the publisher’s own',
                    default: false,
                    description:
                        'Off by default because of volume, not noise. An ads.txt DIRECT sweep measured a median of 74 accounts per file and 1,637 from the largest, and most rows record a relationship with an exchange that thousands of unrelated publishers also use — ten sites sharing one agency’s copied ads.txt produced a 10-way clique of 54 shared nodes. The rows that identify the publisher itself (its own Google account, OWNERDOMAIN, INVENTORYPARTNERDOMAIN) are collected either way. Turn this on when you are comparing two specific sites row by row.',
                },
            },
        },
        scopes: {
            graph: ['node:read', 'node:create', 'edge:create'],
            web_probe: {
                purpose:
                    'Fetch /ads.txt, /app-ads.txt and /.well-known/ documents from the selected host. Anonymous, cookie-less, SSRF-guarded, desktop only.',
            },
        },
        lifecycle: { persistence: 'opt-in', controls: ['progress', 'cancel'], progress: 'determinate' },
    },

    async run(ctx: HostContext): Promise<RunResult> {
        const ids = ctx.input.selection;
        if (!ids.length) return { summary: 'Select a domain or URL node first', counts: { created: 0 } };
        if (!ctx.net?.probe) {
            return {
                summary: 'Publisher file collection needs the desktop shell (the target is dynamic and these files are served without CORS headers). Run this in the desktop app.',
                counts: { created: 0 },
            };
        }

        const allSystems = ctx.params?.all_ad_systems === true;
        const firstSeen = new Date().toISOString();
        const tally = newTally();
        let found = 0;
        let absent = 0;
        let challenged = 0;
        let skipped = 0;
        const filesWithHits: string[] = [];

        for (let i = 0; i < ids.length; i++) {
            if (ctx.signal?.aborted) break;
            const node = await ctx.graph!.get!(ids[i]);
            const seed = node ? hostOf(node) : null;
            if (!seed) {
                skipped++;
                continue;
            }

            for (const f of FILES) {
                if (ctx.signal?.aborted) break;
                ctx.progress?.set?.({
                    percent: Math.round((100 * i) / ids.length),
                    message: `${seed.host}${f.path} (${i + 1}/${ids.length})`,
                });
                const res = await fetchPage(ctx, `https://${seed.host}${f.path}`, MAX_FILE_BYTES);
                if (res.status !== 200 || !res.body) {
                    absent++;
                    continue;
                }
                if (isChallenge(res)) {
                    challenged++;
                    ctx.progress?.log?.(`${seed.host}${f.path}: bot challenge — unknown, not absent`);
                    continue;
                }
                // A host that answers every path with its 200-status SPA shell would otherwise turn
                // every markup collector loose on a file that is not the file we asked for.
                if (/^\s*<(?:!doctype|html)/i.test(res.body)) {
                    absent++;
                    continue;
                }
                found++;
                const out = scan(res.body, f.phase, COLLECTORS, { includeOptIn: allSystems });
                if (out.hits.length) filesWithHits.push(`${seed.host}${f.path} (${out.hits.length})`);
                for (const hit of out.hits) await emitHit(ctx, seed.id, res.url, hit, firstSeen, tally);
            }
        }

        const total = tally.created + tally.reused;
        const parts = [
            total === 0
                ? `No declared accounts found — ${found} file(s) present, ${absent} absent`
                : `${total} declared account(s) from ${found} file(s) — ${tally.created} new, ${tally.reused} already in the graph`,
        ];
        if (filesWithHits.length) parts.push(filesWithHits.slice(0, 6).join(', '));
        if (challenged) parts.push(`${challenged} blocked by a bot challenge (unknown, not absent)`);
        if (skipped) parts.push(`${skipped} selected node(s) were not a domain or URL`);
        if (!allSystems && found) parts.push('ads.txt reseller rows were not collected — turn on “Extract every DIRECT account” to include them');
        if (tally.hubs.length) {
            const worst = tally.hubs.sort((a, b) => b.edges - a.edges)[0];
            parts.push(`${tally.hubs.length} account(s) are already linked to many sites — ${worst.value} has ${worst.edges}; that fan-out reads as a reseller or a network, not one operator`);
        }
        return { summary: parts.join('. ') + '.', counts: { created: tally.created, reused: tally.reused, files: found, absent, challenged } };
    },
});
