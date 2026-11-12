# Security

Report a security problem in this plugin through [GitHub's private vulnerability reporting](https://github.com/wiroai/Wiro-Obsidian/security/advisories/new) instead of a public issue.

How the plugin handles credentials:

- The API key and secret live in Obsidian's keychain. The plugin stores only the ID of each secret in its `data.json`.
- The key is sent only to `api.wiro.ai` and `llm.wiro.ai`, over HTTPS. Requests for the public model catalog and the list of LLM gateway models carry no key.
- A vault file leaves the device only when you choose it for a command (Edit image, Upscale image, Transcribe audio or a file field of a form), and goes to Wiro AI's file storage.
- On desktop, the writing commands stream the answer through Node's `https` module, which the plugin uses for `llm.wiro.ai` only.
- Result files are downloaded from `wiro.ai` hosts only.
