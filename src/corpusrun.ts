// Dev-only: run the whole table over the measurement corpus. Not shipped, not imported by main.
import { COLLECTORS } from './collectors';
import { scan } from './scan';
import type { HitPhase } from './collectors';
declare const process: { argv: string[]; exit(c: number): never };
declare function require(m: string): any;
const fs = require('node:fs'), path = require('node:path');
const ROOT = process.argv[2];
const g = (d: string, f: (n: string) => boolean) => {
    try { return fs.readdirSync(path.join(ROOT, d)).filter(f).map((n: string) => path.join(ROOT, d, n)); } catch { return []; }
};
const ADULT = /adsterra|exoclick|juicyads|popcash|popads|clickadilla|admaven|trafficstars|hilltop|plugrush|monetag|propeller|richads|esnk/;
const SETS: Array<[HitPhase, string[], boolean | 'adult']> = [
    ['markup', g('.', (n) => n.endsWith('.html')), false],
    // neg/*.html is the negative corpus for ADULT-NETWORK patterns only — the pages in it are
    // ordinary sites, so their real GA/GTM/Clarity/Bing tokens are hits, not leaks. The true
    // negative corpus is the minified libraries, where NOTHING may fire.
    ['markup', g('neg', (n) => n.endsWith('.html')), 'adult'],
    ['markup', g('.', (n) => n.startsWith('neg_') && n.endsWith('.js')), true],
    ['adstxt', [...g('ads', (n) => n.endsWith('.txt')), ...g('adstxt', (n) => n.endsWith('.txt')), ...g('aa', (n) => n.endsWith('.txt'))], false],
    ['gtm', g('.', (n) => /^(gtm|gtag|g2|c)[\w.-]*\.js$/.test(n)), false],
    ['wellknown', g('.', (n) => n.startsWith('wk.')), false],
];
const byKey = new Map<string, Set<string>>(), hosts = new Map<string, Set<string>>();
let leaks = 0;
for (const [phase, files, negative] of SETS) {
    for (const f of files) {
        const doc = fs.readFileSync(f, 'utf8');
        const { hits, broken } = scan(doc, phase, COLLECTORS, { includeOptIn: true });
        if (broken.length) { console.error('BROKEN', broken); process.exit(1); }
        for (const h of hits) {
            if (negative === 'adult' && !ADULT.test(h.key)) { /* ordinary tracker on an ordinary page */ }
            else if (negative) { console.error(`LEAK ${h.key} = ${h.value} in ${path.basename(f)}`); leaks++; continue; }
            if (!byKey.has(h.key)) byKey.set(h.key, new Set());
            byKey.get(h.key)!.add(h.value);
            if (!hosts.has(h.value)) hosts.set(h.value, new Set());
            hosts.get(h.value)!.add(path.basename(f));
        }
    }
}
const fired = [...byKey.entries()].sort((a, b) => b[1].size - a[1].size);
console.log(`fired: ${fired.length}/${COLLECTORS.length} collectors · ${hosts.size} distinct values · leaks: ${leaks}`);
for (const [k, v] of fired) console.log(`  ${k.padEnd(36)} ${String(v.size).padStart(5)}  ${[...v].slice(0, 2).join(' | ').slice(0, 90)}`);
const top = [...hosts.entries()].filter(([, f]) => f.size >= 4).sort((a, b) => b[1].size - a[1].size);
console.log(`\nvalues on 4+ corpus files: ${top.length}`);
for (const [v, f] of top.slice(0, 15)) console.log(`  ${String(f.size).padStart(3)}  ${v}`);
