<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <img alt="Marginalia" src="assets/logo-light.svg" width="420">
  </picture>
</p>

<p align="center"><em>Notes and questions in the margin of anything you read or write in Obsidian.</em></p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/screenshot-dark.png">
    <img alt="Notes in the margin beside their passages in Obsidian" src="assets/screenshot-light.png">
  </picture>
</p>

Select a passage and add a note. It sits in the margin beside the passage, and a small number follows the passage. Passages can be any length, cross paragraphs, overlap and nest. A note ending in `?` is a question.

Your text is never touched. Notes live in a plain section at the end of the file, so they read fine in any editor:

```markdown
<!-- marginalia -->
---

## Notes

> the ability to focus without distraction

Why a skill and not a trait?
```

## Using it

- **Add a note:** select a passage and run **Add note** (or right-click → Add note). Enter saves, Esc cancels.
- **Edit a note:** click it. Empty it to delete it, or use the trash button. Every change is one undo step.
- **Edit the passage:** the note follows it, and its quote is rewritten to match.
- **Get around:** **Go to next note** and **Go to previous note**, or **Show all notes** for a list in the sidebar. The list also holds any note whose passage was deleted, to attach to a new selection or remove.

Crowded notes shorten to one line so each stays beside its passage; click one to read it in full. In panes too narrow for a margin, and on phones, tapping a number opens its note under the passage. Reading view shows notes the same way, read-only.

Ordinary footnotes are left alone.

## Settings

- **Margin width**
- **Passage style:** a faint underline, a highlight, or nothing (passages always light up when their note is selected).
- **Hide the notes section while editing** (Live Preview)
- **Notes in reading view**

## Development

Clone into a development vault's `.obsidian/plugins/marginalia` (or symlink it there), then:

```sh
npm install
npm run dev     # rebuilds main.js on save
npm test        # the file format's tests
obsidian plugin:reload id=marginalia && obsidian dev:errors
```

`src/format` is the file format (pure, and where the tests are), `src/editor` is Live Preview, `src/reading` is Reading view.

## License

[MIT](LICENSE). The logo is set in [UnifrakturMaguntia](https://fonts.google.com/specimen/UnifrakturMaguntia) (SIL Open Font License 1.1).
