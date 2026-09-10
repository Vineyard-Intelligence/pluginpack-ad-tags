// Fetching for the ad-tag collectors.
//
// Everything here exists because of three properties of ctx.net.probe, all of them deliberate on
// the host's side and all of them things a naive caller gets wrong:
//
//  1. IT DOES NOT FOLLOW REDIRECTS. `redirect: 'manual'` is the point of the probe — a
//     302-to-login has to be distinguishable from a 200 for presence-detection to mean anything.
//     For us it means the common case (apex 301s to www) returns an EMPTY BODY, and a caller that
//     forgets this reports "no identifiers" for most of the web. followRedirects() below is not a
//     nicety.
//  2. IT CANNOT SET `host`. The header is on the shell's forbidden list, so a probe of a bare IP
//     reaches only that address's DEFAULT vhost. Whatever is name-based on the same box is
//     invisible, and no amount of trying harder here changes that — it is reported, not worked
//     around.
//  3. THE BODY IS DECODED AS UTF-8, unconditionally. A EUC-KR page comes back with its Korean
//     mangled. Every identifier we look for is ASCII so the patterns survive, but nothing here may
//     anchor on a non-ASCII string, and page_title is not worth extracting for the same reason.
//
// The body cap needs saying too: the shell's DEFAULT is 512KB and real pages exceed it —
// huel.com was 657KB, and a gtag/js container is 588KB. We ask for the 2MB hard ceiling and
// still check `truncated`, because a truncated page means "unknown", never "absent".
import type { HostContext, SafeProbeResponse } from './sdk';

export const MAX_BODY_BYTES = 2 * 1024 * 1024; // the shell's HARD_MAX_BYTES; it clamps anything larger
const MAX_REDIRECTS = 5;

export interface Fetched {
    /** The URL we asked for (before redirects). */
    requested: string;
    /** Where we ended up. Differs from `requested` only when redirects were followed. */
    url: string;
    status: number;
    body: string;
    truncated: boolean;
    /** Set when nothing usable came back; `body` is empty then. */
    error?: string;
    /** Redirect hops actually followed, for the run log. */
    hops: number;
}

/** Cheap 32-bit string hash, used only to notice that two URLs returned the same page. */
export function bodyKey(body: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < body.length; i++) {
        h ^= body.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `${body.length}:${h.toString(16)}`;
}

/**
 * One probe, following redirects by hand.
 *
 * Cross-host redirects are followed. That is a real decision and not an oversight: an operator
 * parking six domains on one storefront is exactly the case this plugin is for, and refusing to
 * leave the original host would collect the identifiers of the redirector rather than of the site.
 * The final URL is recorded on every node, so the analyst can see where the tags actually came
 * from.
 */
export async function fetchPage(ctx: HostContext, target: string, maxBytes = MAX_BODY_BYTES): Promise<Fetched> {
    const probe = ctx.net?.probe;
    if (!probe) return { requested: target, url: target, status: 0, body: '', truncated: false, error: 'no probe', hops: 0 };

    let url = target;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        let res: SafeProbeResponse;
        try {
            res = await probe(url, { method: 'GET', maxBytes, timeoutMs: 15_000 });
        } catch (e) {
            return { requested: target, url, status: 0, body: '', truncated: false, error: String(e), hops: hop };
        }
        if (res.error || res.status === 0) {
            return { requested: target, url, status: 0, body: '', truncated: false, error: res.error || 'transport error', hops: hop };
        }
        if (res.status >= 300 && res.status < 400 && res.redirectUrl) {
            if (hop === MAX_REDIRECTS) {
                return { requested: target, url, status: res.status, body: '', truncated: false, error: 'redirect loop', hops: hop };
            }
            try {
                url = new URL(res.redirectUrl, url).toString();
            } catch {
                return { requested: target, url, status: res.status, body: '', truncated: false, error: 'bad redirect target', hops: hop };
            }
            continue;
        }
        return { requested: target, url, status: res.status, body: res.body || '', truncated: res.truncated, hops: hop };
    }
    return { requested: target, url, status: 0, body: '', truncated: false, error: 'redirect loop', hops: MAX_REDIRECTS };
}

/**
 * A Cloudflare/DDoS-Guard interstitial is NOT an absence of identifiers, and reporting it as one
 * is the difference between a limitation and a lie. Seven of fifteen adult/piracy hosts in the
 * measurement corpus answered with one of these, so this is the common case on exactly the targets
 * this plugin is aimed at.
 */
export function isChallenge(f: Fetched): boolean {
    if (f.status === 403 || f.status === 503) return true;
    const head = f.body.slice(0, 4096);
    return (
        /cf-browser-verification|challenge-platform|__cf_chl|Just a moment\.\.\./i.test(head) ||
        /DDoS-Guard|ddos-guard\.net/i.test(head) ||
        /<title>\s*Attention Required!/i.test(head)
    );
}

function isIpLiteral(host: string): boolean {
    return /^[0-9.]+$/.test(host) || host.includes(':');
}

/**
 * Base URLs to try for one seed.
 *
 * Two axes, and they are not equally productive. The catalogue measured `huel.com` carrying a live
 * Stripe key in 657KB of markup while `www.huel.com` served 197KB with none at the same moment —
 * so APEX vs WWW is the axis that finds things, and it is on by default. The 80x443 protocol cross
 * the brief asks for is the other one: `http://h:443` is worth sending because a misconfigured
 * nginx really does answer it with a normal page, but far more often it answers with the plain
 * "The plain HTTP request was sent to HTTPS port" error, which is a server fingerprint rather than
 * a page. Two of the four combinations are pages; two are fingerprints. The count of "4" is not a
 * count of pages, and the summary says so.
 */
export function candidateUrls(
    kind: 'url' | 'domain' | 'ip',
    value: string,
    opts: { crossProtocol: boolean; tryWww: boolean },
): string[] {
    if (kind === 'url') return [value];

    const host = value.trim().replace(/^\[|\]$/g, '');
    if (!host) return [];

    const hosts = [host];
    if (opts.tryWww && !isIpLiteral(host)) {
        // Toggle in whichever direction the seed did not already cover.
        if (/^www\./i.test(host)) hosts.push(host.replace(/^www\./i, ''));
        else if (host.split('.').length >= 2) hosts.push(`www.${host}`);
    }

    const out: string[] = [];
    for (const h of hosts) {
        const bracket = h.includes(':') ? `[${h}]` : h;
        out.push(`https://${bracket}/`, `http://${bracket}/`);
        if (opts.crossProtocol) {
            // Deliberately mismatched. WHATWG URL strips a scheme's own default port, so these two
            // keep their :443 / :80 and stay inside the shell's ALLOWED_PORTS ('', '80', '443').
            out.push(`http://${bracket}:443/`, `https://${bracket}:80/`);
        }
    }
    return out;
}

/** The nginx answer to HTTP-on-the-HTTPS-port. Worth logging as a fingerprint, never parsed. */
export function isProtocolMismatch(f: Fetched): boolean {
    return f.status === 400 && /The plain HTTP request was sent to HTTPS port/i.test(f.body.slice(0, 2048));
}
