# ClaudeKPMods

Mods for Claude Code. There is one so far:

- **[sticky-board](mods/sticky-board/README.md)**: a board pinned beside your Claude Code
  conversation that keeps tasks, open questions, answered questions, design points, your own notes
  and pull requests in view while the conversation scrolls on.

![sticky-board in a real Claude Code session. Beside the conversation, the board shows boxes for
tasks, open questions, answered questions and design points, with older entries scrolled out of
view. Above the prompt, a strip shows the session's pull requests, all of them
live.](media/sticky-board.png)

## Installing

Type this at the prompt of a Claude Code session:

```
/plugin install sticky-board --marketplace kpothos/ClaudeKPMods
```

Or run these in a terminal:

```
claude plugin marketplace add kpothos/ClaudeKPMods
claude plugin install sticky-board@claude-mods
```

What it needs, what it adds to Claude's instructions and how to use it are in the
[sticky-board README](mods/sticky-board/README.md).

## Questions and problems

Open an issue on this repo. Pull requests from other people are turned off.

## License

MIT: free for anybody to use, copy and change. The full text is in [LICENSE](LICENSE).

## Working on a mod

Each mod lives in its own folder under `mods/`.

```
ClaudeKPMods/
├── .claude-plugin/marketplace.json   lists the mods, so they can be installed from this repo
└── mods/
    └── sticky-board/
        ├── .claude-plugin/plugin.json   the mod's name, version and description
        ├── .claude-plugin/icon.png      the mod's icon
        ├── hooks/hooks.json             names the file that holds the mod's code
        ├── hooks/register.tsx           the mod's code
        ├── types/index.d.ts             the values the mod keeps for a session
        ├── tests/                       the mod's tests
        └── README.md                    what the mod does, for the people who install it
```

Try a mod for one session from your own copy of this repo, without installing it:

```
claude --plugin-dir <path to this repo>/mods/sticky-board
```

Or install it from your copy. Claude Code then reads the mod straight from that folder, so an edit
there shows up after `/reload-plugins`:

```
claude plugin marketplace add <path to this repo>
claude plugin install sticky-board@claude-mods
```

Check a mod with:

```
claude plugin validate --profile directory --strict mods/sticky-board
claude plugin test mods/sticky-board
```
