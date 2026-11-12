# Contributing

Thanks for helping with the Wiro AI plugin for Obsidian. Bug reports, fixes and new model suggestions are welcome.

## Report a bug

Open an [issue](https://github.com/wiroai/Wiro-Obsidian/issues) with:

- your Obsidian version and platform (desktop or mobile, and the OS),
- the model you used, as its ID from wiro.ai/models,
- what you did, what you expected and what happened, including the text of the notice.

Never paste your API key or secret into an issue.

## Make a change

```bash
git clone https://github.com/wiroai/Wiro-Obsidian.git
cd Wiro-Obsidian
npm install
npm run dev
```

`npm run dev` rebuilds `main.js` on every change. Link or copy the folder into `<vault>/.obsidian/plugins/wiro-ai/` to load it in a test vault.

Before you open a pull request, run:

```bash
npm run lint
npm test
npm run build
```

`npm run lint` uses [eslint-plugin-obsidianmd](https://github.com/obsidianmd/eslint-plugin), the rules Obsidian's community plugin review runs. The unit tests use fakes for the Wiro AI API and need no key.

Some guidelines:

- Keep `main.js` out of commits. CI builds it for each release.
- UI text is in sentence case, as Obsidian's plugin guidelines ask.
- New network requests need a line in the README's "Network use and privacy" section.
- To change the built-in model list, edit `scripts/update-models.mjs` and run `npm run models`.

## Releases

Maintainers release with `npm version <x.y.z>` and `git push --follow-tags`. The tag has no `v` prefix, because Obsidian looks for a release named exactly like the version in `manifest.json`. The release workflow builds the plugin, attests the files and drafts the GitHub release.
