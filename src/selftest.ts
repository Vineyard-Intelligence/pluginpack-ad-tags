// Self-check for the collector table. Run: npm run selftest
//
// Two halves, and the split is deliberate.
//
// STRUCTURAL always runs and needs nothing but this repo: every regex compiles, every capture
// group it names actually exists, every kind/source is a member of the Type Pack's enum, no two
// collectors share a key. These are the failures that produce a plugin which installs, runs, and
// silently collects nothing — scan() catches a bad regex at runtime and reports it, but by then
// the analyst has already run it against a live target and drawn a conclusion from an empty
// result.
//
// FIXTURES are real bytes lifted from live pages, committed so the check survives the corpus that
// produced it. Each asserts that one collector extracts one exact value from the markup it was
// written against, which is the only thing that distinguishes "this regex is fine" from "this
// regex compiles".
import { COLLECTORS } from './collectors';
import { scan } from './scan';
import type { HitPhase } from './collectors';
import { FIXTURES } from './fixtures';
import { emitHit, newTally } from './emit';
import { adTags } from './ad-tags';
import pack from './main';
import type { HostContext } from './sdk';

// Node-only entry point; the pack itself never sees `process`, so it is declared rather than
// pulled in via @types/node, which would be a dependency for one line.
declare const process: { exit(code: number): never };

const KINDS = new Set(['advertising', 'analytics', 'tag_manager', 'affiliate', 'payment', 'identity', 'site_verification', 'other']);
const SOURCES = new Set(['inline_script', 'script_src', 'meta_tag', 'html_link', 'ads_txt', 'app_ads_txt', 'sellers_json', 'well_known', 'tag_manager_container', 'other']);
const PHASES = new Set<HitPhase>(['markup', 'adstxt', 'wellknown', 'gtm']);

const fail: string[] = [];
const check = (cond: boolean, msg: string) => {
    if (!cond) fail.push(msg);
};

// ---- structural ----
const keys = new Set<string>();
for (const c of COLLECTORS) {
    check(!keys.has(c.key), `duplicate key: ${c.key}`);
    keys.add(c.key);
    check(KINDS.has(c.kind), `${c.key}: kind "${c.kind}" is not in the Type Pack enum`);
    check(SOURCES.has(c.source), `${c.key}: source "${c.source}" is not in the Type Pack enum`);
    check(PHASES.has(c.phase), `${c.key}: phase "${c.phase}" is not a fetch phase`);
    check(c.flags.includes('g'), `${c.key}: flags must include g or exec() loops on the first match`);
    check(!!c.provider || !!c.providerFromGroup, `${c.key}: needs either a provider slug or providerFromGroup`);
    check(/^[a-z0-9_.]*$/.test(c.provider), `${c.key}: provider "${c.provider}" must be a lower-case slug — it is half the node identity, and two spellings split one account into two nodes`);

    let re: RegExp | null = null;
    try {
        re = new RegExp(c.regex, c.flags);
    } catch (e) {
        fail.push(`${c.key}: regex does not compile — ${String(e)}`);
    }
    if (re) {
        // A capture group the pattern does not have yields undefined at runtime, and scan() then
        // skips every match — a collector that looks present and collects nothing, forever.
        const groups = new RegExp(`${c.regex}|`).exec('')!.length - 1;
        check(c.group >= 1 && c.group <= groups, `${c.key}: group ${c.group} but the pattern has ${groups}`);
        if (c.providerFromGroup) check(c.providerFromGroup <= groups, `${c.key}: providerFromGroup ${c.providerFromGroup} but the pattern has ${groups}`);
    }
    if (c.pageGuard) {
        try {
            new RegExp(c.pageGuard, 'i');
        } catch (e) {
            fail.push(`${c.key}: pageGuard does not compile — ${String(e)}`);
        }
    }
    if (c.rejectRegex) {
        try {
            new RegExp(c.rejectRegex, 'i');
        } catch (e) {
            fail.push(`${c.key}: rejectRegex does not compile — ${String(e)}`);
        }
    }
}

// A wallet written as a web.tracking_id is folded to lower case with its provider, and Base58 is
// case-sensitive, so every crypto collector has to route to the Cryptocurrency pack's address type.
for (const c of COLLECTORS) {
    if (c.key.startsWith('crypto_')) check(c.emit === 'crypto_address', `${c.key}: a crypto collector must emit crypto_address`);
}

// ---- fixtures ----
for (const f of FIXTURES) {
    // includeOptIn: the ads.txt DIRECT sweep is off in normal runs for volume reasons, but it is
    // still a collector and still has to be correct when the analyst turns it on.
    const { hits } = scan(f.doc, f.phase, COLLECTORS, { includeOptIn: true });
    // Fixtures name a hit as `provider:value` — the pair that is its identity.
    const values = hits.map((h) => (h.emit === 'email' ? h.value : `${h.provider}:${h.value}`));
    for (const want of f.expect) check(values.includes(want), `fixture "${f.name}": expected ${want}, got [${values.join(', ')}]`);
    for (const not of f.expectNot ?? []) check(!values.includes(not), `fixture "${f.name}": must NOT emit ${not}, but did`);
}

// A regex that fires inside minified JavaScript is the failure mode that keeps recurring, so it
// gets its own assertion rather than being left to the fixtures' good intentions.
const NEGATIVE_PHASES: HitPhase[] = ['markup', 'gtm'];
for (const f of FIXTURES.filter((x) => x.negative)) {
    for (const phase of NEGATIVE_PHASES) {
        const { hits } = scan(f.doc, phase, COLLECTORS, { includeOptIn: true });
        check(hits.length === 0, `negative fixture "${f.name}" (${phase}): matched ${hits.map((h) => `${h.key}=${h.value}`).join(', ')}`);
    }
}

// ---- payment addresses ----
// Hand-written URI shapes, not corpus bytes: the corpus has bitcoin: links and bare addresses (the
// fixtures above) but no EIP-681 request, and these are the shapes the standard defines. The
// addresses are real: Tether's USDT contract, EIP-55's own example, the CashAddr specification's
// first pair, Bitcoin's genesis address.
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const EIP55 = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const pay = (doc: string) => scan(doc, 'markup', COLLECTORS).hits.filter((h) => h.emit === 'crypto_address');
{
    const [h] = pay(`<a href="ethereum:${EIP55}">donate</a>`);
    check(h?.network === 'evm' && h.value === EIP55.toLowerCase(), `eip681: no chain id is evm, lower-cased — got ${JSON.stringify(h)}`);
}
{
    const [h] = pay(`<a href="ethereum:pay-${EIP55}@1?value=1e16">pay</a>`);
    check(h?.network === 'ethereum' && h.value === EIP55.toLowerCase() && h.extra?.chain_id === 1, `eip681: pay- prefix and @1 — got ${JSON.stringify(h)}`);
}
{
    const hits = pay(`<a href="ethereum:${USDT}@56/transfer?address=${EIP55}&amp;uint256=1e6">USDT</a>`);
    const [h] = hits;
    check(hits.length === 1, `eip681 transfer: one payee, not the token contract — got ${hits.length}`);
    check(
        h?.network === 'bsc' && h.value === EIP55.toLowerCase() && h.extra?.token_contract === USDT.toLowerCase() && h.extra?.chain_id === 56,
        `eip681 transfer: payee from address=, token on the edge, @56 is bsc — got ${JSON.stringify(h)}`,
    );
}
check(pay(`<a href="ethereum:${USDT}@1/approve?address=${EIP55}&uint256=1">x</a>`).length === 0, 'eip681: a call that is not a transfer emits nothing');
check(pay(`<a href="ethereum:${USDT}@1/transfer?uint256=1">x</a>`).length === 0, 'eip681: a transfer without a payee emits nothing');
{
    const [h] = pay(`<a href="ethereum:${EIP55}@324">zk</a>`);
    check(h?.network === 'evm' && h.extra?.chain_id === 324, `eip681: an unlisted chain id stays evm, with the id kept — got ${JSON.stringify(h)}`);
}
{
    // Hex is not EIP-681's chain id syntax, but pages write BSC as @0x38. Read as digits it stopped
    // at the 0 and put chain_id 0 on the edge, which is no chain at all.
    const [h] = pay(`<a href="ethereum:${EIP55}@0x38">bsc</a>`);
    check(h?.network === 'evm' && h.value === EIP55.toLowerCase() && h.extra?.chain_id === undefined, `eip681: @0x38 is no chain id, not chain 0 — got ${JSON.stringify(h)}`);
    // …and the request after it still parses: the payee, not Tether's contract.
    const ts = pay(`<a href="ethereum:${USDT}@0x38/transfer?address=${EIP55}">x</a>`);
    check(
        ts.length === 1 && ts[0].value === EIP55.toLowerCase() && ts[0].network === 'evm' && ts[0].extra?.chain_id === undefined && ts[0].extra?.token_contract === USDT.toLowerCase(),
        `eip681: a hex chain id before /transfer — payee from address=, no chain id — got ${JSON.stringify(ts)}`,
    );
    const [g] = pay(`<a href="ethereum:${EIP55}@56abc">x</a>`);
    check(g?.extra?.chain_id === undefined, `eip681: digits running into letters are not a chain id — got ${JSON.stringify(g)}`);
}
{
    const hits = pay('<a href="BITCOIN:BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4?amount=0.1">QR</a> bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
    check(
        hits.length === 1 && hits[0].network === 'bitcoin' && hits[0].value === 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        `bip21: an upper-case QR link and the bare address are one wallet — got ${JSON.stringify(hits)}`,
    );
}
check(pay('<a href="bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb">x</a>').length === 0, 'bip21: a Base58 address failing its checksum is dropped');
{
    const [h] = pay('<a href="bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa">x</a>');
    check(h?.network === 'bitcoin' && h.value === '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'bip21: a legacy Bitcoin address is kept exactly as written');
}
{
    const [h] = pay('<a href="bitcoincash:1BpEi6DfDAUFd7GtittLSdBeYJvcoaVggu">x</a>');
    check(h?.network === 'bitcoin_cash' && h.value === 'qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a', `bch: a legacy address in a bitcoincash: link becomes its CashAddr — got ${JSON.stringify(h)}`);
}
{
    const [h] = pay('<a href="litecoin:3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy">x</a>');
    check(h?.network === 'litecoin' && h.value === 'MQMHBtvnBfxTzt3K2bdxgSE7qZPHSXWsGM', `ltc: a 3… address becomes its M… form — got ${JSON.stringify(h)}`);
}

// emitHit against a stand-in graph: the node type, what it carries, the edge, and the refusal.
// `links` are edges already in the project. `neighbors: false` is a host that did not grant
// edge:read, which hands the plugin no way to read them.
type Link = { id: string; from_node_id: string; to_node_id: string; label: string };
async function emitScenario(
    existing: Array<{ id: string; type: string; data: Record<string, unknown> }>,
    refuse = false,
    { links = [] as Link[], neighbors = true } = {},
) {
    const created: Array<{ type: string; data: Record<string, unknown> }> = [];
    const edges: Array<{ from: string; to: string; label: string; data?: Record<string, unknown> }> = [];
    const ctx = {
        graph: {
            async list({ type }: { type: string }) {
                return { nodes: existing.filter((n) => n.type === type) };
            },
            ...(neighbors
                ? {
                      async neighbors(id: string) {
                          return { nodes: [], edges: links.filter((e) => e.from_node_id === id || e.to_node_id === id) };
                      },
                  }
                : {}),
            async createNode(d: { type: string; data: Record<string, unknown> }) {
                if (refuse) throw new Error(`type "${d.type}" is not defined by any installed typepack.`);
                created.push(d);
                return { id: `n${created.length}`, ...d };
            },
            async createEdge(e: { from: string; to: string; label: string; data?: Record<string, unknown> }) {
                edges.push(e);
                return { id: `e${edges.length}`, ...e };
            },
        },
    } as unknown as HostContext;
    const tally = newTally();
    for (const hit of pay(`<a href="ethereum:${USDT}@56/transfer?address=${EIP55}">x</a>`)) {
        await emitHit(ctx, 'seed', 'https://shop.example/', hit, '2026-11-14T00:00:00Z', tally);
    }
    return { created, edges, tally };
}
{
    const { created, edges, tally } = await emitScenario([]);
    check(
        created.length === 1 && created[0].type === 'cryptocurrency.crypto_address' && JSON.stringify(created[0].data) === JSON.stringify({ network: 'bsc', address: EIP55.toLowerCase() }),
        `emit: one Crypto Address carrying network and address only — got ${JSON.stringify(created)}`,
    );
    check(
        edges.length === 1 &&
            edges[0].from === 'seed' &&
            edges[0].label === 'accepts payment to' &&
            edges[0].data?.token_contract === USDT.toLowerCase() &&
            edges[0].data?.observed_on === 'https://shop.example/',
        `emit: "accepts payment to" from the seed, token and page on the edge — got ${JSON.stringify(edges)}`,
    );
    check(tally.created === 1 && tally.refused === 0, 'emit: counted as created');
}
{
    // An analyst's node in EIP-55 case is the same account; a node on another network is not.
    const { created, edges, tally } = await emitScenario([
        { id: 'other', type: 'cryptocurrency.crypto_address', data: { network: 'ethereum', address: EIP55 } },
        { id: 'mine', type: 'cryptocurrency.crypto_address', data: { network: 'bsc', address: EIP55 } },
    ]);
    check(created.length === 0 && tally.reused === 1 && edges[0]?.to === 'mine', `emit: reuses the checksummed node on the same network — got ${JSON.stringify({ created, edges })}`);
}
{
    const { created, edges, tally } = await emitScenario([], true);
    check(created.length === 0 && edges.length === 0 && tally.refused === 1, 'emit: a refused create is counted, not thrown, and links nothing');
}
{
    // The analyst already drew seed → wallet as "donation wallet". One edge per pair: a different
    // label would be staged as a relabel on every run, so the existing wording goes back unchanged
    // and only the data is added.
    const mine = { id: 'mine', type: 'cryptocurrency.crypto_address', data: { network: 'bsc', address: EIP55.toLowerCase() } };
    const { edges } = await emitScenario([mine], false, { links: [{ id: 'e0', from_node_id: 'seed', to_node_id: 'mine', label: 'donation wallet' }] });
    check(
        edges.length === 1 && edges[0].label === 'donation wallet' && edges[0].data?.token_contract === USDT.toLowerCase(),
        `emit: an existing link keeps its label and gets the data — got ${JSON.stringify(edges)}`,
    );
    // A link the other way round, or from another seed, is another pair.
    const other = await emitScenario([mine], false, { links: [{ id: 'e1', from_node_id: 'mine', to_node_id: 'seed', label: 'paid from' }, { id: 'e2', from_node_id: 'shop2', to_node_id: 'mine', label: 'x' }] });
    check(other.edges[0]?.label === 'accepts payment to', `emit: only the seed → node link is that pair — got ${JSON.stringify(other.edges)}`);
}
{
    // Fan-out: an address already linked from 40 sites is named, which needs the node's edges.
    const mine = { id: 'mine', type: 'cryptocurrency.crypto_address', data: { network: 'bsc', address: EIP55.toLowerCase() } };
    const links = Array.from({ length: 40 }, (_, i) => ({ id: `e${i}`, from_node_id: `site${i}`, to_node_id: 'mine', label: 'accepts payment to' }));
    const read = await emitScenario([mine], false, { links });
    check(read.tally.hubs.length === 1 && read.tally.hubs[0].edges === 40, `emit: a 40-site payment address is reported as a hub — got ${JSON.stringify(read.tally.hubs)}`);
    // Without edge:read there is nothing to count and nothing to keep: own label, no hub, no throw.
    const blind = await emitScenario([mine], false, { links, neighbors: false });
    check(blind.tally.hubs.length === 0 && blind.edges[0]?.label === 'accepts payment to', 'emit: without neighbors the run still links, with its own label');
}
// …which is why the plugin must ask for edge:read: the host hands over neighbors only with it.
check(
    (adTags.manifest.scopes?.graph ?? []).includes('edge:read'),
    'ad_tags: declares edge:read, or the existing-link and fan-out checks above never run in a project',
);

// The pack page is the catalog's About: at most about 1,500 characters, and nothing about Vineyard
// itself. 1.4.0's payment-address note took it to 1,897 before it was cut back.
check(pack.description.length <= 1500, `pack page is ${pack.description.length} characters, over 1,500`);
check(!/type pack|typepack|review|staged/i.test(pack.description), 'pack page talks about how Vineyard installs or stages');

if (fail.length) {
    console.error(`FAIL — ${fail.length} problem(s) in ${COLLECTORS.length} collectors:`);
    for (const f of fail) console.error(`  - ${f}`);
    process.exit(1);
}
console.log(`ok — ${COLLECTORS.length} collectors, ${FIXTURES.length} fixtures`);
