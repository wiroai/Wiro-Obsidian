/** The API key of a Wiro AI project, plus its secret for signature-based projects. */
export interface Credentials {
	apiKey: string;
	apiSecret?: string;
}

let lastNonce = 0;

/** A nonce for signature authentication: the time in milliseconds, never repeated. */
export function nextNonce(now: number = Date.now()): string {
	lastNonce = Math.max(now, lastNonce + 1);
	return String(lastNonce);
}

/** HMAC-SHA256 of `message` with `key`, hex encoded. Uses the Web Crypto API. */
export async function hmacSha256Hex(key: string, message: string): Promise<string> {
	const encoder = new TextEncoder();
	const cryptoKey = await crypto.subtle.importKey(
		'raw',
		encoder.encode(key),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
	return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Headers for one request. API key only projects send `x-api-key`; signature
 * projects also send a fresh nonce and HMAC-SHA256(key = API key,
 * message = API secret + nonce). See https://wiro.ai/docs/authentication
 */
export async function authHeaders(credentials: Credentials): Promise<Record<string, string>> {
	const headers: Record<string, string> = { 'x-api-key': credentials.apiKey };
	if (credentials.apiSecret) {
		const nonce = nextNonce();
		headers['x-nonce'] = nonce;
		headers['x-signature'] = await hmacSha256Hex(credentials.apiKey, credentials.apiSecret + nonce);
	}
	return headers;
}
