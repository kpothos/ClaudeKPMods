# ClaudeKPMods

Mods for Claude Code. Each mod lives in its own folder under `mods/`.

```
ClaudeKPMods/
├── .claude-plugin/marketplace.json   lists the mods, so they can be installed from this folder
└── mods/
    └── sticky-board/
        ├── .claude-plugin/plugin.json   the mod's name, version and description
        ├── hooks/hooks.json             names the file that holds the mod's code
        ├── hooks/register.tsx           the mod's code
        ├── types/index.d.ts             the values the mod keeps for a session
        └── tests/                       the mod's tests
```

## sticky-board

A pinned board of what is going on in the session. Every entry shows the time it last changed and
carries a label (`T3`, `Q2`, `A1`, `D2`, `P1`) that stays with it and is never reused, so you can
name an entry in a prompt ("do T3 next", "reopen D1"). When a prompt names a label, the mod hands
Claude what it stands for.

In the panel, each box with its own scrolling list:

- **Tasks.** Claude keeps its task list here with a tool the mod adds. Tasks made with the
  built-in task tools, in sessions that have them, show up too.
- **Open questions.** Claude adds the questions it leaves for you and takes them off once you
  answer. A question you dismiss in a question dialog stays on the board. If Claude ends a reply
  on a question without adding it, the mod adds it. Press the `○` beside a question to take it off
  yourself.
- **Answered.** The questions you asked, each with a short version of Claude's answer, so the
  answer stays in view after the full reply has scrolled away. Press `○` to check an entry off, or
  the `↑` beside the answer to scroll the conversation back to the full one (fullscreen mode). The
  newest 30 are kept.
- **Design points.** The points of a plan that still need deciding, in the plan's order: not
  settled yet, being discussed, or settled with the decision in a line or two. Claude takes them
  one at a time and marks one settled only when you have agreed. The box is drawn only while there
  are design points. The board is cleared with the conversation, so Claude also writes each
  decision into the plan itself.

Across the window, in the strip above the prompt:

- **Pull requests.** One row for each pull request Claude is taking through to release: the stage
  it is at (pre-PR tests, PR open, CI tests, merge and deploy, live), a `✔` or `✖` for whether
  everything is fine, and a few words on why. Claude reports these as it goes; the mod does not
  check GitHub itself. The strip is drawn only while there are pull requests.

Where the panel sits: beside the conversation in fullscreen mode from 110 columns, above the prompt
otherwise. It opens by itself in a wide window (144 columns, or 110 once you have opened it
yourself); `/sticky` opens it at any width. Above the prompt the boxes sit side by side, so only
the ones with something in them are drawn.

Scrolling: the mouse wheel scrolls the box under the pointer. A box with more than fits shows
`▲ n more lines` and `▼ n more lines`, which you can click, or reach with ctrl+x tab, Tab and Enter.
A panel too short to give every box a row scrolls as one.

`/clear` empties the board and starts the labels again from 1.

## Using a mod

Try it for one session, without installing (give the path to your copy of this repo):

```
claude --plugin-dir <path to this repo>/mods/sticky-board
```

Install it for every session from your copy of this repo. Claude Code then reads the mod straight
from that folder, so an edit there shows up after `/reload-plugins`:

```
claude plugin marketplace add <path to this repo>
claude plugin install sticky-board@claude-mods
```

Or install it from GitHub, typed at the prompt of a Claude Code session:

```
/plugin install sticky-board --marketplace kpothos/ClaudeKPMods
```

Remove it again with `claude plugin uninstall sticky-board@claude-mods`.

## Checking a mod

```
claude plugin validate mods/sticky-board
claude plugin test mods/sticky-board
```
