import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

// Copies the version from package.json into manifest.json and records the
// minimum app version for it in versions.json. Runs from `npm version`.
const targetVersion = process.env.npm_package_version;

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync('manifest.json', `${JSON.stringify(manifest, null, '\t')}\n`);

const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
if (!(targetVersion in versions)) {
	versions[targetVersion] = minAppVersion;
	writeFileSync('versions.json', `${JSON.stringify(versions, null, '\t')}\n`);
}
