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
import type { HostContext, GraphNode } from './sdk';
import type { Hit } from './scan';

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
    /** value -> edge count, for identifiers already linked to more sites than fanoutLimit allows. */
    hubs: Array<{ value: string; edges: number; kind: string }>;
}

export function newTally(): EmitTally {
    return { created: 0, reused: 0, hubs: [] };
}

async function findExisting(ctx: HostContext, type: string, key: string, value: string): Promise<GraphNode | null> {
    if (!ctx.graph?.list) return null;
    try {
        const { nodes } = await ctx.graph.list({ type });
        return nodes.find((n) => String(n.data?.[key] ?? '').toLowerCase() === value.toLowerCase()) ?? null;
    } catch {
        return null;
    }
}

async function edgeCount(ctx: HostContext, nodeId: string): Promise<number> {
    if (!ctx.graph?.neighbors) return 0;
    try {
        const { edges } = await ctx.graph.neighbors(nodeId);
        return edges.length;
    } catch {
        return 0;
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
    const isEmail = hit.emit === 'email';
    const type = isEmail ? 'identity.email_address' : 'web.tracking_id';
    const idKey = isEmail ? 'email' : 'value';

    const existing = await findExisting(ctx, type, idKey, hit.value);
    let node: GraphNode;
    if (existing) {
        node = existing;
        tally.reused++;
        const edges = await edgeCount(ctx, String(node.id));
        if (edges >= fanoutLimit(hit.kind)) tally.hubs.push({ value: hit.value, edges, kind: hit.kind });
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
        label: isEmail ? 'pays' : 'carries tracking ID',
        data: { collector: hit.key, source: hit.source, observed_on: observedOn },
    });
}
