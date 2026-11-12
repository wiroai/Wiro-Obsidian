# Security

Report a security problem in this plugin through [GitHub's private vulnerability reporting](https://github.com/wiroai/Wiro-Obsidian/security/advisories/new) instead of a public issue.

How the plugin handles credentials:

- The API key and secret live in Obsidian's keychain. The plugin stores only the ID of each secret in its `data.json`.
- The key is sent only to `api.wiro.ai`, over HTTPS. Requests for the public model catalog carry no key.
- Result files are downloaded from `wiro.ai` hosts only.
