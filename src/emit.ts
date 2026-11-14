// Turning hits into graph nodes.
//
// Two things here are not bookkeeping.
//
// DE-DUPLICATION BY HAND. The host bridge de-duplicates createNode by identity only when the
// type's definition resolves from the Type Packs installed in THIS project. If the infrastructure
// pack is not activated, resolveType returns null, identity comes back null, and every run adds
// another copy of the same identifier — which for this plugin means the pivot silently stops
// working, since the whole value of a tracking ID is that two sites converge on one node. So we do
// the lookup the plugin can always do. Re-read per hit rather than hoisted, so two sites in one
// selection that share an identifier converge on each other within the same run.
//
// FAN-OUT AS A BASE RATE. A tracking ID carried by three sites is an operator link. The same ID
// carried by ninety is a marketing agency's account sprayed across unrelated clients, or a CMS
// template default — and merging on it fuses genuinely unrelated clusters into one false
// operator. The count is the test, and the node already holds it: the number of edges pointing at
// it. We do not refuse to create the edge — the analyst decides, and a high count is sometimes the
// finding — but a run that quietly produced a hundred-edge hub and called it a discovery has
// misled its reader, so the count is reported.
//
// ONE LINK PER PAIR, AND ITS WORDING IS NOT OURS TO CHANGE. A project holds one edge per
// (from, to), and a create against a pair that is already linked is staged as a proposal to
// RELABEL that edge. So a run that re-asserted its own label over an analyst's "donation wallet"
// put a relabel in the review on every re-run, and with Apply automatically on it overwrote the
// analyst's wording. When the pair is linked, the existing label is sent back unchanged and only
// the data is added. Both this and the fan-out count read the node's edges, which the host hands
// over only with `edge:read`; without it there is nothing to read, and the run falls back to its
// own label and a count of zero.
import type { HostContext, GraphNode } from './sdk';
import type { Hit } from './scan';
import { identityFold } from './crypto-address';

/** The Cryptocurrency type pack's address type, identified by (network, address, memo). */
export const CRYPTO_ADDRESS = 'cryptocurrency.crypto_address';

/**
 * Above these many existing edges, an identifier is more likely shared infrastructure than a
 * shared operator. The two numbers differ because the artefacts differ: an analytics property or
 * a tag-manager container is a SERVICE token, routinely installed by one agency across every
 * client it has, so it goes noisy early. An advertising, affiliate or payment account is where
 * money arrives, which is a far stronger reason for one party to hold it — it takes a much larger
 * fan-out before the innocent explanation beats the operator one.
 */
const FANOUT_SERVICE = 15;
const FANOUT_ACCOUNT = 40;

function fanoutLimit(kind: string): number {
    return kind === 'analytics' || kind === 'tag_manager' || kind === 'site_verification' ? FANOUT_SERVICE : FANOUT_ACCOUNT;
}

export interface EmitTally {
    created: number;
    reused: number;
    /** Payment addresses the project refused to create: the Cryptocurrency type pack missing, or
     *  older than the network written. Counted apart because the fix is the project's, not the
     *  value's. */
    refused: number;
    /** value -> edge count, for identifiers already linked to more sites than fanoutLimit allows. */
    hubs: Array<{ value: string; edges: number; kind: string }>;
}

export function newTally(): EmitTally {
    return { created: 0, reused: 0, refused: 0, hubs: [] };
}

/** Match on every identity field: an email alone, or a tracking ID's (provider, value). */
async function findExisting(ctx: HostContext, type: string, match: Record<string, string>): Promise<GraphNode | null> {
    if (!ctx.graph?.list) return null;
    const same = (n: GraphNode) =>
        Object.entries(match).every(([k, v]) => String(n.data?.[k] ?? '').toLowerCase() === v.toLowerCase());
    try {
        const { nodes } = await ctx.graph.list({ type });
        return nodes.find(same) ?? null;
    } catch {
        return null;
    }
}

/** How many edges the node already has, and the label of the seed's link to it if there is one. */
async function linksOf(ctx: HostContext, nodeId: string, seedId: string): Promise<{ count: number; seedLabel: string | null }> {
    if (!ctx.graph?.neighbors) return { count: 0, seedLabel: null };
    try {
        const { edges } = await ctx.graph.neighbors(nodeId);
        const fromSeed = edges.find((e) => String(e.from_node_id) === seedId && String(e.to_node_id) === nodeId);
        return { count: edges.length, seedLabel: fromSeed ? fromSeed.label : null };
    } catch {
        return { count: 0, seedLabel: null };
    }
}

/**
 * Create (or reuse) the node for one hit and link the seed to it.
 *
 * `observedOn` is the URL the bytes actually came from AFTER redirects, not the URL the analyst
 * selected. On a seed that 301s to another host those are different, and the one that matters for
 * "where did this tag live" is the former.
 */
export async function emitHit(
    ctx: HostContext,
    seedId: string,
    observedOn: string,
    hit: Hit,
    firstSeen: string,
    tally: EmitTally,
): Promise<void> {
    if (hit.emit === 'crypto_address') return emitPaymentAddress(ctx, seedId, observedOn, hit, tally);
    const isEmail = hit.emit === 'email';
    const type = isEmail ? 'identity.email_address' : 'web.tracking_id';
    const existing = await findExisting(
        ctx,
        type,
        isEmail ? { email: hit.value } : { provider: hit.provider, value: hit.value },
    );
    let node: GraphNode;
    let seedLabel: string | null = null;
    if (existing) {
        node = existing;
        tally.reused++;
        const links = await linksOf(ctx, String(node.id), seedId);
        seedLabel = links.seedLabel;
        const label = isEmail ? hit.value : `${hit.provider} ${hit.value}`;
        if (links.count >= fanoutLimit(hit.kind)) tally.hubs.push({ value: label, edges: links.count, kind: hit.kind });
    } else {
        const data: Record<string, unknown> = isEmail
            ? { email: hit.value, domain: hit.value.split('@')[1] || '' }
            : {
                  value: hit.value,
                  provider: hit.provider,
                  kind: hit.kind,
                  source: hit.source,
                  observed_on: observedOn,
                  first_seen: firstSeen,
              };
        node = await ctx.graph!.createNode!({ type, data });
        tally.created++;
    }

    await ctx.graph!.createEdge!({
        from: seedId,
        to: String(node.id),
        label: seedLabel ?? (isEmail ? 'pays' : 'carries tracking ID'),
        data: { collector: hit.key, source: hit.source, observed_on: observedOn },
    });
}

/** An existing address node on the same network whose address folds to the same value. */
async function findAddress(ctx: HostContext, network: string, address: string): Promise<GraphNode | null> {
    if (!ctx.graph?.list) return null;
    const want = identityFold(address);
    try {
        const { nodes } = await ctx.graph.list({ type: CRYPTO_ADDRESS });
        return (
            nodes.find(
                (n) =>
                    n.data?.network === network &&
                    identityFold(String(n.data?.address ?? '')) === want &&
                    // A payment link names no memo, so only the memo-less address is the same one.
                    (n.data?.memo == null || n.data.memo === ''),
            ) ?? null
        );
    } catch {
        return null;
    }
}

/**
 * A payment address: a Cryptocurrency pack address node, linked from the seed by
 * "accepts payment to".
 *
 * The node carries only what identifies it. When and where the address was seen belongs to this
 * observation — the edge — and the type's own `first_seen` means first activity ON CHAIN, which a
 * web page cannot tell us.
 */
async function emitPaymentAddress(
    ctx: HostContext,
    seedId: string,
    observedOn: string,
    hit: Hit,
    tally: EmitTally,
): Promise<void> {
    const network = hit.network ?? 'unknown';
    let node = await findAddress(ctx, network, hit.value);
    let seedLabel: string | null = null;
    if (node) {
        tally.reused++;
        const links = await linksOf(ctx, String(node.id), seedId);
        seedLabel = links.seedLabel;
        if (links.count >= fanoutLimit(hit.kind)) tally.hubs.push({ value: `${network} ${hit.value}`, edges: links.count, kind: hit.kind });
    } else {
        try {
            node = await ctx.graph!.createNode!({ type: CRYPTO_ADDRESS, data: { network, address: hit.value } });
        } catch (e) {
            // Cancellation is not a refusal.
            if ((e as { name?: string } | null)?.name === 'AbortError') throw e;
            tally.refused++;
            return;
        }
        tally.created++;
    }
    await ctx.graph!.createEdge!({
        from: seedId,
        to: String(node.id),
        label: seedLabel ?? 'accepts payment to',
        data: { collector: hit.key, source: hit.source, observed_on: observedOn, ...(hit.extra ?? {}) },
    });
}
