// The collector table's execution engine.
//
// A collector is a regex plus the metadata needed to turn a match into a node. Everything
// interesting is in the constraints, not the loop:
//
//  - The emitted node value is the identifier as the page carries it, and the provider slug rides
//    alongside it. web.tracking_id's identity is (provider, value): half these networks issue a
//    bare 5-9 digit integer as the account ID, and an ExoClick zone 4823917 must not converge with
//    an unrelated Monetag zone 4823917. So a provider is required, and one issuer has one slug.
//  - `pageGuard` is a whole-document precondition. It exists for patterns that are individually
//    ambiguous but unambiguous in context — a bare `UA-` token is worth emitting only on a page
//    that also loads a Google analytics script.
//  - `reject` carries values that are real matches and still must not become nodes: vendor demo
//    accounts, all-zero placeholders, the IDs that appear on thousands of unrelated sites. A hub
//    value is the worst outcome this plugin has, because it does not look like a bug — it looks
//    like a discovery, with hundreds of edges.
import { PROVIDER_ALIAS, googlePubPrefix } from './collectors';
import type { Collector, HitPhase } from './collectors';

export interface Hit {
    key: string;
    provider: string;
    kind: string;
    source: string;
    /** The identifier as it appeared. */
    raw: string;
    /** The node value: the identifier verbatim (identity is provider + value). */
    value: string;
    emit: 'tracking_id' | 'email';
    note: string;
}

/** Compiled once per run; a `g` regex carries mutable lastIndex, so never share one across docs. */
function compile(c: Collector): { re: RegExp; guard: RegExp | null; rej: RegExp | null } | null {
    try {
        const flags = c.flags.includes('g') ? c.flags : `${c.flags}g`;
        return {
            re: new RegExp(c.regex, flags),
            guard: c.pageGuard ? new RegExp(c.pageGuard, 'i') : null,
            rej: c.rejectRegex ? new RegExp(c.rejectRegex, 'i') : null,
        };
    } catch {
        return null; // a malformed collector must not sink the run; scan() reports the count
    }
}

export interface ScanResult {
    hits: Hit[];
    /** Collectors whose regex failed to compile. A build-time bug, surfaced at runtime. */
    broken: string[];
}

/**
 * Apply the normalisation a regex cannot express.
 *
 * All three exist because identity is the value STRING: any difference that survives to the node
 * is a second node for one account, and on the canvas that reads as two operators rather than as
 * one bad normalisation.
 */
function normalizeRaw(c: Collector, raw: string): string {
    let v = raw;
    if (c.urldecode) {
        try {
            v = decodeURIComponent(v);
        } catch {
            // A stray % that is not an escape. The undecoded form is still the right value.
        }
    }
    if (c.normalize === 'lower') v = v.toLowerCase();
    return v;
}

export function scan(
    doc: string,
    phase: HitPhase,
    collectors: Collector[],
    opts: { includeOptIn?: boolean } = {},
): ScanResult {
    const hits: Hit[] = [];
    const broken: string[] = [];
    const seen = new Set<string>(); // one node per distinct (provider, value) per document

    for (const c of collectors) {
        if (c.phase !== phase) continue;
        if (c.optIn && !opts.includeOptIn) continue;
        const built = compile(c);
        if (!built) {
            broken.push(c.key);
            continue;
        }
        if (built.guard && !built.guard.test(doc)) continue;

        let m: RegExpExecArray | null;
        let guardRuns = 0;
        while ((m = built.re.exec(doc)) !== null) {
            // A zero-width match would spin forever; step past it. Real collectors all capture
            // something, so this only fires on a malformed pattern that still compiled.
            if (m[0] === '') built.re.lastIndex++;
            if (++guardRuns > 5000) break; // a pattern matching this often is a bug, not a finding

            const matched = (m[c.group] ?? '').trim();
            if (!matched) continue;
            // Reject lists are written against the value as it appears in the document, so they are
            // checked BEFORE normalisation as well as after — a hub value spelled in mixed case
            // would otherwise walk past a list that names its lower-case form.
            if (c.reject?.includes(matched)) continue;
            if (built.rej?.test(matched)) continue;
            const raw0 = normalizeRaw(c, matched);
            if (c.reject?.includes(raw0)) continue;

            // ads.txt rows name their own ad system in field 1; everything else has a fixed slug.
            const slug = c.providerFromGroup ? (m[c.providerFromGroup] ?? '').trim().toLowerCase() : c.provider;
            if (!slug) continue;
            const provider = PROVIDER_ALIAS[slug] ?? slug;
            const raw = googlePubPrefix(provider, raw0);

            const emit = c.emit === 'email' ? 'email' : 'tracking_id';
            const dedupKey = emit === 'email' ? raw : `${provider}:${raw}`;
            if (seen.has(dedupKey)) continue;
            seen.add(dedupKey);

            hits.push({ key: c.key, provider, kind: c.kind, source: c.source, raw, value: raw, emit, note: c.note });
        }
    }
    return { hits, broken };
}

/**
 * Tag-manager containers named in the page, for the second-hop fetch.
 *
 * This is the one thing that defeats the plugin's central limitation. A container is served as
 * static JavaScript, so fetching it as TEXT recovers the AW-/G-/UA-/ca-pub- values it would have
 * injected at runtime — identifiers that are provably absent from the markup we can read. The
 * catalogue found payment-grade Google Ads accounts this way on pages whose own HTML carried
 * none.
 *
 * It is not free and the cost is not the request. The fetch goes to Google carrying the analyst's
 * address alongside the container ID, so a third party learns that this container was looked up.
 * The target does not, but the log exists. The plugin's parameter defaults it ON because the yield
 * is the highest of any collector here, and the parameter description says exactly this.
 */
export function containerIds(doc: string): string[] {
    const out = new Set<string>();
    const re = /googletagmanager\.com\/(?:gtm\.js|ns\.html)\?id=(GTM-[A-Z0-9]{5,9})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(doc)) !== null) out.add(m[1]);
    return [...out].slice(0, 4); // a page with more than four containers is a tag-manager demo
}
