# Bidirectional Folgezettel Plugin for Obsidian

![Version](https://img.shields.io/static/v1?label=bidirectional-folgezettel&message=1.2.2&color=brightgreen)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Automatic bidirectional linking for folgezettel-style note addresses in Obsidian. When you create a note whose title carries a folgezettel address, the plugin links it to its parent and writes the matching link back into the parent, so the two notes always point at each other. This plugin is a TypeScript translation of the `org-roam-folgezettel.el` Emacs package by Blaine Mooers, and it runs on both desktop and mobile.

## What is folgezettel?

Folgezettel is a hierarchical note-addressing system derived from Niklas Luhmann's Zettelkasten methodology. This variant is friendly to computer filenames. Notes receive structured addresses such as `1.2a3c` that encode where each note sits in the tree.

| Address | Meaning |
|---------|---------|
| `1` | Root note |
| `1.2` | Second branch of note 1 |
| `1.2a` | First child of 1.2 |
| `1.2a3` | Third sub-branch of 1.2a |
| `1.2a3aa` | 27th sub-branch of 1.2a3 |
| `1.2a3aa55` | 55th sub-branch of 1.2a3aa |

A few rules govern the addresses.

**Alternation.** Below the root, numbers and letters alternate. A number is always followed by a letter, and a letter is always followed by a number. The plugin enforces this when it generates the next address.

**Multi-character segments.** A number can contain several digits, and letters continue past `z` as `aa`, `ab`, and so on. No further periods or other symbols are allowed.

**Root notes and the index of indices.** Plain integers such as `1`, `2`, and `7` are root notes. They are treated as children of a special index note whose title is `00.0`. Root notes are filed in that index under headings you choose, for example `Subject Matter` and `Project Support`.

**Children of a root integer.** The first level below a root integer uses dot-number form rather than a letter. A child of `7` is `7.1`, then `7.2`, because a bare letter suffix such as `7a` would be ambiguous against the multi-digit root numbering.

## Features

**Automatic parent linking.** When you create a note whose title contains a folgezettel address, the plugin finds the parent address and links the new note to it.

**Bidirectional links.** A backlink to the parent is written into the child note, and a forward link to the child is written into the parent.

**Cursor-aware next-sibling creation.** The "Create next child note" command reads your cursor position and works out the next address for you, so there is nothing to type and no placeholder to delete.

**Cross-reference links.** When you manually insert a link to another note, the plugin adds the reciprocal link to the target note.

**Child address suggestions.** The "Suggest next child address" command shows the next available address without creating anything.

**Templates for child notes.** New child notes can be seeded from the core Templates plugin or from Templater.

**Choice of link style.** Links are generated as wikilinks or as Markdown links, according to your setting.

## Installation

### From Obsidian community plugins

If the plugin is listed in the community catalog, open **Settings** then **Community plugins**, click **Browse**, search for "Bidirectional Folgezettel", then click **Install** and **Enable**.

### Manual installation

1. Download `main.js` and `manifest.json` from the latest release.
2. Create the folder `<vault>/.obsidian/plugins/bidirectional-folgezettel/`.
3. Copy the two files into that folder.
4. Reload Obsidian.
5. Enable the plugin in **Settings** then **Community plugins**.

### From source

```bash
git clone https://github.com/MooersLab/bidirectional-folgezettel
cd bidirectional-folgezettel
make install
make build
```

Then copy the generated `main.js` and `manifest.json` into your vault's plugin folder as described under manual installation.

## Usage

### Commands

All commands appear in the command palette and can be bound to hotkeys.

| Command | Description |
|---------|-------------|
| **Add backlink to parent note** | Writes the bidirectional link between the active note and its parent. |
| **Create next child note** | Creates the next sibling note, inferred from the cursor, and links it. |
| **Suggest next child address** | Shows the next available child address without creating a note. |
| **Select template for new note** | Picks a template, then creates a new note from it. |
| **Create new folgezettel note** | Creates a note, seeding the address from the cursor when possible. |

A ribbon icon labelled "Folgezettel: Add parent link" runs the backlink command.

### How next-sibling creation works

When you run **Create next child note**, the plugin looks at where your cursor sits in the current note.

If the cursor is inside a list of links to child notes, the plugin takes the highest index already present in that list, increments it to the next sibling, and appends the new link to the bottom of that same list under the same heading. The new note's title and filename are both seeded with the computed index, so you can start typing the rest of the title right away. Because the heading above the list already identifies the category, the plugin does not ask you to choose a scheme when you add a root note to the `00.0` index.

If the cursor is not inside such a list, the plugin creates the next top-level sibling of the current note instead, increments the current note's own address, and links it under the current note's parent.

The **Create new folgezettel note** command uses the same inference. It falls back to a name prompt only when the active note has no folgezettel address to work from.

### Automatic linking

When automatic processing is enabled, which is the default, the plugin acts on two events. On note creation, if the new note's title contains a folgezettel address, it creates the links to and from the parent note. On manual linking, when you insert a link to another note, it adds the reciprocal link to the target note.

### Hotkeys

1. Open **Settings** then **Hotkeys**.
2. Search for "Folgezettel".
3. Assign your preferred shortcuts.

## Settings

The settings tab groups the options under headings.

| Setting | Description | Default |
|---------|-------------|---------|
| Auto-process new notes | Add folgezettel links and apply templates when notes are created | On |
| Show notifications | Display a notice when links are inserted | On |
| Auto bidirectional cross-links | Create reciprocal links when you manually insert a link | On |
| Link format | Wikilinks or Markdown links | Wikilinks |
| Parent link description | Text shown for links to parent notes | "Parent" |
| Child link description | Text shown for links to child notes; empty uses the note title | Empty |
| Backlink heading | Heading for parent backlinks in child notes | "Related Notes" |
| Forward link heading | Heading for child links in parent notes | "Child Notes" |
| Cross-link heading | Heading for reciprocal cross-reference links | "Related Notes" |
| Template folder | Folder containing note templates | "Templates" |
| Default template | Template applied to all new folgezettel notes | Empty |
| Template source for child notes | None, core Templates plugin, or Templater | None |
| Folgezettel regex | Pattern used to match addresses in note titles | See main.ts |

## Development

### Prerequisites

- Node.js 16 or newer
- npm

### Setup

```bash
git clone https://github.com/MooersLab/bidirectional-folgezettel
cd bidirectional-folgezettel
make install
make test
make build
```

### Make targets

```
make install        Install npm dependencies
make dev            Run development mode with file watching
make build          Type-check and build the production bundle
make test           Run the Jest test suite
make test-coverage  Run the tests with a coverage report
make lint           Type-check with tsc (no emit)
make clean          Remove build artifacts
make all            Run lint, tests, and build
```

The `make build` target runs `tsc --noEmit --skipLibCheck` and then bundles with esbuild. The `node_modules` esbuild binary is platform-specific, so build on the same operating system where you installed dependencies.

### Project structure

```
bidirectional-folgezettel/
├── main.ts              # Plugin source code
├── main.test.ts         # Jest test suite
├── __mocks__/
│   └── obsidian.ts      # Obsidian API mocks for tests
├── main.js              # Compiled plugin (build output)
├── manifest.json        # Plugin metadata
├── package.json         # npm configuration
├── tsconfig.json        # TypeScript configuration
├── jest.config.js       # Test configuration
├── esbuild.config.mjs   # Build configuration
├── Makefile             # Build automation
└── README.md            # This file
```

### Testing

The suite uses ts-jest in a node environment, with the Obsidian API mocked in `__mocks__/obsidian.ts`. Run `make test` for a single pass or `make test-coverage` for a coverage report.

## Contributing

1. Fork the repository.
2. Create a feature branch with `git checkout -b feature/name`.
3. Make your changes and confirm that `make lint` and `make test` pass.
4. Commit your work.
5. Push the branch and open a pull request.

## Update history

| Version | Changes | Date |
|:-------:|---------|:----:|
| 1.2.2 | Cursor-aware next-sibling creation. The command infers the next address from cursor position, seeds the title and filename, removes the subject-versus-project prompt, and appends each child link to the bottom of its list. | 2026 May 24 |

## Funding

- NIH: R01 CA242845, R01 AI088011
- NIH: P30 CA225520 (PI: R. Mannel); P30 GM145423 (PI: A. West)

## License

Released under the MIT License. Copyright (c) 2026 Blaine Mooers and the Board of Regents of the University of Oklahoma. See the [LICENSE](LICENSE) file for the full text.
