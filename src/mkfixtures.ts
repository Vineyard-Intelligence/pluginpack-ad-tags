// Dev-only: lift one real snippet per firing collector out of the corpus into src/fixtures.ts.
import { COLLECTORS } from './collectors';
import { scan } from './scan';
import type { HitPhase } from './collectors';
declare const process: { argv: string[] };
declare function require(m: string): any;
const fs = require('node:fs'), path = require('node:path');
const ROOT = process.argv[2];
const g = (d: string, f: (n: string) => boolean) => {
    try { return fs.readdirSync(path.join(ROOT, d)).filter(f).map((n: string) => path.join(ROOT, d, n)); } catch { return []; }
};
const SETS: Array<[HitPhase, string[]]> = [
    ['markup', [...g('.', (n) => n.endsWith('.html')), ...g('neg', (n) => n.endsWith('.html'))]],
    ['adstxt', [...g('ads', (n) => n.endsWith('.txt')), ...g('aa', (n) => n.endsWith('.txt'))]],
    ['gtm', g('.', (n) => /^(gtm|gtag|g2)[\w.-]*\.js$/.test(n))],
    ['wellknown', g('.', (n) => n.startsWith('wk.'))],
];
const W = 130;
const win = (doc: string, i: number, len: number) => doc.slice(Math.max(0, i - W), Math.min(doc.length, i + len + W));

type Fx = { name: string; phase: HitPhase; doc: string; expect: string[] };
const out: Fx[] = [];
const done = new Set<string>();
for (const c of COLLECTORS) {
    if (done.has(c.key)) continue;
    const set = SETS.find(([p]) => p === c.phase);
    if (!set) continue;
    for (const f of set[1]) {
        const doc = fs.readFileSync(f, 'utf8');
        let re: RegExp;
        try { re = new RegExp(c.regex, c.flags.includes('g') ? c.flags : c.flags + 'g'); } catch { break; }
        const m = re.exec(doc);
        if (!m) continue;
        let snippet = win(doc, m.index, m[0].length);
        if (c.pageGuard) {
            const gm = new RegExp(c.pageGuard, 'i').exec(doc);
            if (gm) snippet = win(doc, gm.index, gm[0].length) + '\n' + snippet;
        }
        const hits = scan(snippet, c.phase, COLLECTORS, { includeOptIn: true }).hits.filter((h) => h.key === c.key);
        if (!hits.length) continue;
        out.push({ name: `${c.key} @ ${path.basename(f)}`, phase: c.phase, doc: snippet, expect: [hits[0].value] });
        done.add(c.key);
        break;
    }
}
const NEG = g('.', (n) => n.startsWith('neg_') && n.endsWith('.js'));
const negs = NEG.map((f: string) => ({
    name: `minified library: ${path.basename(f)}`,
    // 3KB of the densest part of each library. Minified code is uniform, so a middle slice is
    // representative, and the whole file would put a quarter-megabyte of somebody else's build in
    // this repo to prove the same thing.
    doc: fs.readFileSync(f, 'utf8').slice(20_000, 23_000),
}));
const q = (s: string) => JSON.stringify(s);
const body = [
    ...out.map((f) => `    { name: ${q(f.name)}, phase: ${q(f.phase)}, expect: [${f.expect.map(q).join(', ')}], doc: ${q(f.doc)} },`),
    ...negs.map((n) => `    { name: ${q(n.name)}, phase: "markup", negative: true, expect: [], doc: ${q(n.doc)} },`),
].join('\n');
fs.writeFileSync(process.argv[3], body);
console.log(`${out.length} positive + ${negs.length} negative fixtures`);
