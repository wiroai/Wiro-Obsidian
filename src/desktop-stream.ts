import { Platform } from 'obsidian';
import type { StreamTransport } from './wiro/gateway';

type HttpsModule = typeof import('https');

/**
 * Streams LLM answers on desktop. requestUrl returns a response only once it
 * has ended, so the desktop app reads the stream with Node's https module,
 * which Electron provides. The module is imported only on desktop; on mobile
 * there is no Node, this resolves to null and the text commands wait for the
 * whole answer.
 */
export async function loadDesktopStreamTransport(): Promise<StreamTransport | null> {
	if (Platform.isDesktop) {
		try {
			const https = await import('https');
			return httpsTransport(https);
		} catch {
			return null;
		}
	}
	return null;
}

function httpsTransport(https: HttpsModule): StreamTransport {
	return (request, onData) =>
		new Promise((resolve, reject) => {
			const url = new URL(request.url);
			if (url.protocol !== 'https:' || url.hostname !== 'llm.wiro.ai') {
				reject(new Error('Streaming is only used for llm.wiro.ai.'));
				return;
			}
			const req = https.request(url, { method: 'POST', headers: request.headers }, (response) => {
				response.setEncoding('utf8');
				response.on('data', (chunk: string) => onData(chunk));
				response.on('end', () => resolve({ status: response.statusCode ?? 0 }));
				response.on('error', (error: Error) => reject(error));
			});
			req.on('error', (error: Error) => reject(error));
			if (request.signal) {
				if (request.signal.aborted) {
					req.destroy(new Error('Cancelled.'));
					return;
				}
				request.signal.addEventListener('abort', () => req.destroy(new Error('Cancelled.')), { once: true });
			}
			req.end(request.body);
		});
}
