/** A multipart/form-data body for requestUrl, which takes bytes but no FormData. */
export interface MultipartBody {
	body: ArrayBuffer;
	contentType: string;
}

export interface MultipartFile {
	field: string;
	fileName: string;
	contentType: string;
	data: ArrayBuffer;
}

function boundary(): string {
	let random = '';
	for (let index = 0; index < 24; index += 1) random += Math.floor(Math.random() * 16).toString(16);
	return `----WiroObsidian${random}`;
}

/** Quotes a header parameter value: no line breaks, escaped quotes. */
function quoted(value: string): string {
	return `"${value.replace(/[\r\n]+/g, ' ').replace(/"/g, '%22')}"`;
}

/** Builds a multipart body with text fields and files. */
export function buildMultipart(fields: Record<string, string>, files: MultipartFile[], separator: string = boundary()): MultipartBody {
	const encoder = new TextEncoder();
	const parts: Uint8Array[] = [];
	for (const [name, value] of Object.entries(fields)) {
		parts.push(encoder.encode(`--${separator}\r\nContent-Disposition: form-data; name=${quoted(name)}\r\n\r\n${value}\r\n`));
	}
	for (const file of files) {
		parts.push(
			encoder.encode(
				`--${separator}\r\nContent-Disposition: form-data; name=${quoted(file.field)}; filename=${quoted(file.fileName)}\r\n` +
					`Content-Type: ${file.contentType || 'application/octet-stream'}\r\n\r\n`,
			),
		);
		parts.push(new Uint8Array(file.data));
		parts.push(encoder.encode('\r\n'));
	}
	parts.push(encoder.encode(`--${separator}--\r\n`));
	const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.byteLength;
	}
	return { body: bytes.buffer, contentType: `multipart/form-data; boundary=${separator}` };
}
