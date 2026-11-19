<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <img alt="Marginalia" src="assets/logo-light.svg" width="420">
  </picture>
</p>

<p align="center"><em>Notes and questions in the margin of anything you read or write in Obsidian.</em></p>

Work in progress: a rewrite of [marginalia](https://github.com/sammcclenaghan/marginalia) the Obsidian way.

## Development

Clone into a development vault's `.obsidian/plugins/marginalia` (or symlink it there), then:

```sh
npm install
npm run dev     # rebuilds main.js on save
obsidian plugin:reload id=marginalia && obsidian dev:errors
```

## License

[MIT](LICENSE). The logo is set in [UnifrakturMaguntia](https://fonts.google.com/specimen/UnifrakturMaguntia) (SIL Open Font License 1.1).
