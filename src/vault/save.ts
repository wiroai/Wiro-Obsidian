import { normalizePath, TFolder, type App, type TFile } from 'obsidian';
import { splitExtension } from './files';

/** Creates the folder and any missing parents. */
async function ensureFolder(app: App, path: string): Promise<void> {
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFolder) return;
	if (existing) throw new Error(`"${path}" is a file, so files can't be saved in it. Pick another folder in the plugin settings.`);
	const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
	if (parent) await ensureFolder(app, parent);
	await app.vault.createFolder(path);
}

/** "folder/name.png", or "folder/name 1.png" when that name is taken. */
function availablePath(app: App, path: string): string {
	const { base, extension } = splitExtension(path);
	let candidate = path;
	for (let index = 1; app.vault.getAbstractFileByPath(candidate); index += 1) {
		candidate = `${base} ${index}${extension ? `.${extension}` : ''}`;
	}
	return candidate;
}

/**
 * Saves a file next to the note's other attachments, or in `folder` when the
 * settings name one.
 */
export async function saveAttachment(
	app: App,
	data: ArrayBuffer,
	fileName: string,
	folder: string,
	sourcePath: string,
): Promise<TFile> {
	let path: string;
	const target = folder.trim() ? normalizePath(folder) : '';
	if (target && target !== '/') {
		await ensureFolder(app, target);
		path = availablePath(app, normalizePath(`${target}/${fileName}`));
	} else {
		path = await app.fileManager.getAvailablePathForAttachment(fileName, sourcePath);
	}
	return app.vault.createBinary(path, data);
}

/** An embed for the file, in the link style the vault uses: ![[file.png]] or ![file.png](file.png). */
export function embedFor(app: App, file: TFile, sourcePath: string): string {
	return `!${app.fileManager.generateMarkdownLink(file, sourcePath)}`;
}
