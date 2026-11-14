// A cryptocurrency payment address found in markup, as the node the Cryptocurrency type pack wants.
//
// These used to be web.tracking_id nodes with the chain in `provider`. That type folds provider AND
// value to lower case for identity, which is right for an ad-network account and wrong for a
// wallet: a Monero address and a legacy Bitcoin, Litecoin or Dogecoin address are Base58, where
// case is part of the address, so two different wallets could fold into one node. The Cryptocurrency
// pack identifies an address by (network, address) and folds only what carries no meaning (hex and
// bech32 case, a CashAddr prefix), so the collector has to say which network — and write the
// address in the pack's canonical form, because conversions such as Litecoin `3…` → `M…` change
// the string and are not folded at comparison.
import { EVM_CHAIN_NETWORK, canonicalAddress } from './crypto-address';
import type { Network } from './crypto-address';

/** URI schemes (BIP-21 and its relatives) and the bare-address collectors' provider slugs. */
const SLUG_NETWORK: Record<string, Network> = {
    bitcoin: 'bitcoin',
    bitcoincash: 'bitcoin_cash',
    litecoin: 'litecoin',
    dogecoin: 'dogecoin',
    monero: 'monero',
};

export interface PaymentTarget {
    network: Network;
    /** Canonical form for `network`. */
    address: string;
    /** What the link said beyond the address, for the edge. */
    extra: Record<string, unknown>;
}

/** `?a=b&amp;c=d` as markup carries it: `&amp;` is how an href writes `&`. */
function queryParams(query: string | undefined): Map<string, string> {
    const out = new Map<string, string>();
    for (const part of (query ?? '').split('&')) {
        const pair = part.replace(/^amp;/i, '');
        const eq = pair.indexOf('=');
        if (eq <= 0) continue;
        let value = pair.slice(eq + 1);
        try {
            value = decodeURIComponent(value);
        } catch {
            // A stray % that is not an escape; the raw text is still the value.
        }
        out.set(pair.slice(0, eq).toLowerCase(), value);
    }
    return out;
}

/**
 * An EIP-681 `ethereum:` request: `ethereum:[pay-]<target>[@<chain_id>][/<function>][?<params>]`.
 *
 * Groups: 1 target address, 2 what follows `@`, 3 function name, 4 query. Three shapes matter:
 *
 *   - no function: the target IS the payee.
 *   - `/transfer?address=<payee>&uint256=…`: an ERC-20 payment. The target is the TOKEN CONTRACT —
 *     every site taking USDT would otherwise converge on Tether's contract and look like one
 *     operator — and the payee is the `address` parameter. The token rides on the edge.
 *   - any other function (`approve`, …): a contract call, not a payment, so nothing is emitted.
 *
 * The chain id names the network when the type pack has it (1 ethereum, 56 bsc, 137 polygon, …);
 * an absent or unlisted one is `evm`, an address whose chain is not established, with the id kept
 * on the edge. EIP-681 lets a wallet assume its current chain when the id is absent, so "absent"
 * really does mean the page did not say.
 */
function eip681(m: RegExpExecArray): PaymentTarget | null {
    const [, target, chainToken, fn, query] = m;
    // EIP-681's chain id is decimal. Anything else after `@` (`@0x38`, written for BSC) is not
    // one: guessing hex would be a reading the standard does not give, and digits-only matching
    // made `@0x38` chain 0. So it counts as absent, which is what `evm` is for.
    const chainId = chainToken && /^\d{1,12}$/.test(chainToken) ? chainToken : undefined;
    let payee = target;
    let token: string | null = null;
    if (fn) {
        if (fn.toLowerCase() !== 'transfer') return null;
        const to = queryParams(query).get('address');
        if (!to) return null;
        payee = to;
        token = target;
    }
    const network: Network = chainId ? EVM_CHAIN_NETWORK[String(Number(chainId))] ?? 'evm' : 'evm';
    const address = canonicalAddress(network, payee);
    if (!address) return null;
    const extra: Record<string, unknown> = { uri_scheme: 'ethereum' };
    if (chainId) extra.chain_id = Number(chainId);
    if (token) extra.token_contract = token.toLowerCase();
    return { network, address, extra };
}

/**
 * The payment address one crypto collector match names, or null when there is none — an unknown
 * scheme, a value that fails its own network's checksum (a typo or a decoy is not a payable
 * address), or an EIP-681 call that is not a payment.
 */
export function paymentTarget(key: string, slug: string, m: RegExpExecArray, raw: string): PaymentTarget | null {
    if (key === 'crypto_eip681_uri') return eip681(m);
    const network = SLUG_NETWORK[slug];
    if (!network) return null;
    const address = canonicalAddress(network, raw);
    if (!address) return null;
    return { network, address, extra: key === 'crypto_payment_uri' ? { uri_scheme: slug } : {} };
}
