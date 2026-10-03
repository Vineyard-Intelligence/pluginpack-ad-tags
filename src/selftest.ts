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

if (fail.length) {
    console.error(`FAIL — ${fail.length} problem(s) in ${COLLECTORS.length} collectors:`);
    for (const f of fail) console.error(`  - ${f}`);
    process.exit(1);
}
console.log(`ok — ${COLLECTORS.length} collectors, ${FIXTURES.length} fixtures`);
