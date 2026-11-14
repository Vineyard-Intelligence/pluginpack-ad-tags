// Cryptocurrency address formats, for writing `cryptocurrency.crypto_address` nodes.
//
// The Cryptocurrency type pack identifies an address by (network, address, memo), and the app folds
// only the spellings of ONE string at comparison: hex and bech32 case, a CashAddr prefix. Anything
// that needs re-encoding to become the same string — a Litecoin `3…` alias, a Bitcoin Cash legacy
// address, a TRON hex address — is the writer's job, because base58check needs SHA-256 and identity
// keys are computed synchronously in the app. So a pack has to know the formats itself: to pick a
// network when the source does not say, and to write the canonical form when it does.
//
// Pure and dependency-free (SHA-256 included, written out below) so the selftest exercises exactly
// what the bundle runs. The same file is copied into each pack that writes crypto addresses, like
// sdk.ts; a fix here does not reach the other copies by itself.

export type Network =
    | 'bitcoin'
    | 'bitcoin_cash'
    | 'bitcoin_sv'
    | 'bitcoin_gold'
    | 'litecoin'
    | 'dogecoin'
    | 'dash'
    | 'zcash'
    | 'monero'
    | 'verge'
    | 'ethereum'
    | 'ethereum_classic'
    | 'bsc'
    | 'polygon'
    | 'arbitrum'
    | 'optimism'
    | 'base'
    | 'avalanche_c'
    | 'evm'
    | 'tron'
    | 'solana'
    | 'xrpl'
    | 'ton'
    | 'cardano'
    | 'bnb_beacon'
    | 'unknown';

/** EVM networks of the type pack, by EIP-155 chain id. A chain id not listed here is `evm`. */
export const EVM_CHAIN_NETWORK: Record<string, Network> = {
    '1': 'ethereum',
    '10': 'optimism',
    '56': 'bsc',
    '61': 'ethereum_classic',
    '137': 'polygon',
    '8453': 'base',
    '42161': 'arbitrum',
    '43114': 'avalanche_c',
};

const EVM_NETWORKS = new Set<string>(['evm', ...Object.values(EVM_CHAIN_NETWORK)]);

// ---- SHA-256 ------------------------------------------------------------------------------
//
// For base58check only. Written out rather than taken from crypto.subtle because subtle is async
// and every caller here is a synchronous parse step, and because the worker's environment is not
// this file's to assume.

const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
    0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
    0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
    0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
    0xc67178f2,
]);

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

export function sha256(data: Uint8Array): Uint8Array {
    const len = data.length;
    const padded = ((len + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(padded);
    buf.set(data);
    buf[len] = 0x80;
    const view = new DataView(buf.buffer);
    view.setUint32(padded - 8, Math.floor((len * 8) / 0x100000000));
    view.setUint32(padded - 4, (len * 8) >>> 0);

    const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const w = new Uint32Array(64);
    for (let off = 0; off < padded; off += 64) {
        for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
        for (let i = 16; i < 64; i++) {
            const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }
        let [a, b, c, d, e, f, g, hh] = h;
        for (let i = 0; i < 64; i++) {
            const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
            const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
            hh = g;
            g = f;
            f = e;
            e = (d + t1) | 0;
            d = c;
            c = b;
            b = a;
            a = (t1 + t2) | 0;
        }
        h[0] += a;
        h[1] += b;
        h[2] += c;
        h[3] += d;
        h[4] += e;
        h[5] += f;
        h[6] += g;
        h[7] += hh;
    }
    const out = new Uint8Array(32);
    const ov = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]);
    return out;
}

// ---- Base58 / base58check -----------------------------------------------------------------

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Decode(s: string): Uint8Array | null {
    if (!s || s.length > 128) return null;
    const bytes: number[] = [];
    for (const ch of s) {
        let carry = B58.indexOf(ch);
        if (carry < 0) return null;
        for (let j = 0; j < bytes.length; j++) {
            carry += bytes[j] * 58;
            bytes[j] = carry & 0xff;
            carry >>= 8;
        }
        while (carry > 0) {
            bytes.push(carry & 0xff);
            carry >>= 8;
        }
    }
    let zeros = 0;
    while (zeros < s.length && s[zeros] === '1') zeros++;
    const out = new Uint8Array(zeros + bytes.length);
    for (let i = 0; i < bytes.length; i++) out[zeros + i] = bytes[bytes.length - 1 - i];
    return out;
}

export function base58Encode(b: Uint8Array): string {
    const digits: number[] = [];
    for (const byte of b) {
        let carry = byte;
        for (let j = 0; j < digits.length; j++) {
            carry += digits[j] << 8;
            digits[j] = carry % 58;
            carry = (carry / 58) | 0;
        }
        while (carry > 0) {
            digits.push(carry % 58);
            carry = (carry / 58) | 0;
        }
    }
    let out = '';
    for (let k = 0; k < b.length && b[k] === 0; k++) out += '1';
    for (let j = digits.length - 1; j >= 0; j--) out += B58[digits[j]];
    return out;
}

const checksum4 = (payload: Uint8Array) => sha256(sha256(payload)).subarray(0, 4);

/** A base58check value's version byte and body, or null when it does not decode or checksum. */
export function base58CheckDecode(s: string): { version: number; body: Uint8Array } | null {
    const raw = base58Decode(s);
    if (!raw || raw.length < 5) return null;
    const payload = raw.subarray(0, raw.length - 4);
    const sum = checksum4(payload);
    for (let i = 0; i < 4; i++) if (sum[i] !== raw[raw.length - 4 + i]) return null;
    return { version: payload[0], body: payload.slice(1) };
}

export function base58CheckEncode(version: number, body: Uint8Array): string {
    const payload = new Uint8Array(1 + body.length);
    payload[0] = version;
    payload.set(body, 1);
    const full = new Uint8Array(payload.length + 4);
    full.set(payload);
    full.set(checksum4(payload), payload.length);
    return base58Encode(full);
}

// ---- bech32 / bech32m (BIP-173, BIP-350) -------------------------------------------------

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

/** The lower-case hrp of a valid bech32 or bech32m string, or null. No 90-character limit: Cardano
 *  addresses are longer, and the limit is not part of the encoding. */
export function bech32Hrp(value: string): string | null {
    if (value.length > 1024 || (value !== value.toLowerCase() && value !== value.toUpperCase())) return null;
    const v = value.toLowerCase();
    const sep = v.lastIndexOf('1');
    if (sep < 1 || sep + 7 > v.length) return null;
    const hrp = v.slice(0, sep);
    const values: number[] = [];
    for (let i = 0; i < hrp.length; i++) {
        const c = hrp.charCodeAt(i);
        if (c < 33 || c > 126) return null;
        values.push(c >>> 5);
    }
    values.push(0);
    for (let i = 0; i < hrp.length; i++) values.push(hrp.charCodeAt(i) & 31);
    for (let i = sep + 1; i < v.length; i++) {
        const d = BECH32_CHARSET.indexOf(v[i]);
        if (d < 0) return null;
        values.push(d);
    }
    let chk = 1;
    for (const x of values) {
        const top = chk >>> 25;
        chk = ((chk & 0x1ffffff) << 5) ^ x;
        for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= BECH32_GEN[i];
    }
    return chk === 1 || chk === 0x2bc830a3 ? hrp : null;
}

// ---- CashAddr ------------------------------------------------------------------------------

const CASH_GEN = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n];

function cashPolymod(values: number[]): bigint {
    let c = 1n;
    for (const d of values) {
        const top = c >> 35n;
        c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(d);
        for (let i = 0; i < 5; i++) if ((top >> BigInt(i)) & 1n) c ^= CASH_GEN[i];
    }
    return c ^ 1n;
}

const prefixValues = (prefix: string) => [...prefix].map((ch) => ch.charCodeAt(0) & 31);

/** The bare lower-case payload of a Bitcoin Cash CashAddr (prefix optional, any one case), or null. */
export function cashAddrPayload(value: string): string | null {
    const m = /^(?:bitcoincash:)?([02-9ac-hj-np-zAC-HJ-NP-Z]{9,120})$/i.exec(value);
    if (!m) return null;
    const payload = m[1];
    if (payload !== payload.toLowerCase() && payload !== payload.toUpperCase()) return null;
    const lower = payload.toLowerCase();
    const values = [...prefixValues('bitcoincash'), 0, ...[...lower].map((ch) => BECH32_CHARSET.indexOf(ch))];
    return cashPolymod(values) === 0n ? lower : null;
}

/** A legacy hash as a bare CashAddr payload: `type` 0 for P2PKH, 1 for P2SH. */
export function cashAddrEncode(type: number, hash: Uint8Array): string {
    const sizeCode = ({ 20: 0, 24: 1, 28: 2, 32: 3, 40: 4, 48: 5, 56: 6, 64: 7 } as Record<number, number>)[hash.length] ?? 0;
    const bytes = [(type << 3) | sizeCode, ...hash];
    const data: number[] = [];
    let acc = 0;
    let bits = 0;
    for (const b of bytes) {
        acc = (acc << 8) | b;
        bits += 8;
        while (bits >= 5) {
            bits -= 5;
            data.push((acc >>> bits) & 31);
        }
        acc &= (1 << bits) - 1;
    }
    if (bits > 0) data.push((acc << (5 - bits)) & 31);
    const mod = cashPolymod([...prefixValues('bitcoincash'), 0, ...data, 0, 0, 0, 0, 0, 0, 0, 0]);
    for (let i = 0; i < 8; i++) data.push(Number((mod >> BigInt(5 * (7 - i))) & 31n));
    return data.map((d) => BECH32_CHARSET[d]).join('');
}

// ---- what a writer needs ------------------------------------------------------------------

/**
 * The network a value's FORMAT settles on its own, with the value in canonical form; otherwise
 * `evm` for a 0x address (its chain is not in the string) and `unknown` for anything else.
 *
 * Only formats that name one network count: a bech32 hrp (`bc`, `ltc`, `btg`, `bnb`, `addr`,
 * `stake`), a CashAddr that checksums under `bitcoincash`, and a 34-character Base58Check value with
 * TRON's version byte. A `1…`/`3…` address is the same bytes on Bitcoin, Bitcoin Cash and Bitcoin
 * SV, and a TON raw `0:<hex>` address is also how Everscale writes its addresses, so those stay
 * `unknown` — guessing would put the address on a chain where it may hold nothing.
 */
export function classifyAddress(raw: string): { network: Network; address: string } {
    const v = raw.trim();
    if (/^0x[0-9a-fA-F]{40}$/.test(v)) return { network: 'evm', address: v.toLowerCase() };
    const hrp = bech32Hrp(v);
    const byHrp: Record<string, Network> = {
        bc: 'bitcoin',
        ltc: 'litecoin',
        btg: 'bitcoin_gold',
        bnb: 'bnb_beacon',
        addr: 'cardano',
        stake: 'cardano',
    };
    if (hrp && byHrp[hrp]) return { network: byHrp[hrp], address: v.toLowerCase() };
    const cash = /^bitcoincash:/i.test(v) || /^[qpzr]/i.test(v) ? cashAddrPayload(v) : null;
    if (cash && (/^bitcoincash:/i.test(v) || cash.length === 42 || cash.length === 61)) {
        return { network: 'bitcoin_cash', address: cash };
    }
    if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(v)) {
        const d = base58CheckDecode(v);
        if (d && d.version === 0x41 && d.body.length === 20) return { network: 'tron', address: v };
    }
    return { network: 'unknown', address: v };
}

/**
 * The canonical form of `raw` as an address on `network`, or null when it is not one.
 *
 * For a source that NAMES the network (a `bitcoin:` payment link, an `ethereum:` request): the
 * value is checked against that network's formats, re-encoded where the type pack's canonical
 * form differs (Litecoin `3…` → `M…`, Bitcoin Cash legacy → CashAddr), and folded where case
 * carries no meaning. A value that fails its own checksum is not a payable address — a typo or a
 * decoy — and null keeps it out of the graph. Monero is accepted as written: its Base58 is
 * block-encoded with a Keccak checksum, which is not worth a hash implementation here.
 */
export function canonicalAddress(network: Network, raw: string): string | null {
    const v = raw.trim();
    if (!v) return null;
    if (EVM_NETWORKS.has(network)) return /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : null;
    const b58 = (versions: number[]) => {
        const d = base58CheckDecode(v);
        return d && d.body.length === 20 && versions.includes(d.version) ? d : null;
    };
    switch (network) {
        case 'bitcoin':
            if (bech32Hrp(v) === 'bc') return v.toLowerCase();
            return b58([0x00, 0x05]) ? v : null;
        case 'litecoin': {
            if (bech32Hrp(v) === 'ltc') return v.toLowerCase();
            const d = b58([0x30, 0x32, 0x05]);
            if (!d) return null;
            // `3…` is Litecoin's old P2SH version byte, shared with Bitcoin; the same script hash is
            // `M…` under the current one, and that is the form the type pack names.
            return d.version === 0x05 ? base58CheckEncode(0x32, d.body) : v;
        }
        case 'dogecoin':
            return b58([0x1e, 0x16]) ? v : null;
        case 'bitcoin_cash': {
            const cash = cashAddrPayload(v);
            if (cash) return cash;
            const d = b58([0x00, 0x05]);
            return d ? cashAddrEncode(d.version === 0x05 ? 1 : 0, d.body) : null;
        }
        case 'monero':
            return /^[1-9A-HJ-NP-Za-km-z]{95}$|^[1-9A-HJ-NP-Za-km-z]{106}$/.test(v) ? v : null;
        default:
            return v;
    }
}

/**
 * The app's `normalize: crypto_address` fold, for matching an existing node by hand: hex and
 * bech32 (listed hrps) to lower case, CashAddr to its bare lower-case payload, TON raw to lower
 * case, everything else as written. Kept in step with the app's identity-normalize.ts, which is
 * the one that decides; this copy only has to agree with it on the values a pack writes.
 */
export function identityFold(raw: string): string {
    if (raw.length > 1024) return raw;
    if (/^0x[0-9a-fA-F]{40}$/.test(raw) || /^-?\d+:[0-9a-fA-F]{64}$/.test(raw)) return raw.toLowerCase();
    const hrp = bech32Hrp(raw);
    if (hrp && ['bc', 'tb', 'bcrt', 'ltc', 'tltc', 'btg', 'bnb', 'addr', 'addr_test', 'stake', 'stake_test'].includes(hrp)) {
        return raw.toLowerCase();
    }
    const prefixed = /^bitcoincash:/i.test(raw);
    if (prefixed || (/^[qpzr]/i.test(raw) && (raw.length === 42 || raw.length === 61))) {
        const cash = cashAddrPayload(raw);
        if (cash) return cash;
    }
    return raw;
}
