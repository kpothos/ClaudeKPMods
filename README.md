# ClaudeKPMods

Mods for Claude Code. There is one so far: **sticky-board**.

## sticky-board

### The problem

In a long Claude Code session, the things you need to keep hold of scroll away.

- Claude asks you three questions, then writes two more screens, and the questions are gone.
- You ask something and get a good answer. Twenty minutes later you are scrolling back to find it.
- On a bigger plan it gets worse. There is a task list, a few design points you have not settled
  yet and a pull request part-way to release, all of it somewhere above you in the conversation.

So you scroll back, again and again, and lose your place each time.

### What it does

sticky-board pins those things on screen. They stay put while the conversation moves on, and
Claude keeps them up to date as it works.

Beside the conversation:

```
╭────────────────────────────────────────────────╮
│ Tasks 3 open, 1 done                           │
│ 14:05 ◼ T2 Agree the design for saved carts    │
│ 14:05 ◻ T3 Add the saved-cart table            │
│ 14:05 ◻ T4 Run every test suite                │
│ 14:05 ✔ T1 Read the current checkout code      │
╰────────────────────────────────────────────────╯
╭────────────────────────────────────────────────╮
│ Open questions 1 · press ○ when answered       │
│ 14:05 ○ Q1 Should a saved cart expire after 30 │
│         days?                                  │
╰────────────────────────────────────────────────╯
╭────────────────────────────────────────────────╮
│ Answered 1 · ○ done · ↑ scroll back            │
│ 14:05 ○ A1 Why not keep carts in the browser?  │
│       ↑ They would be lost when the person     │
│         changes device, so they are kept on    │
│         the server.                            │
╰────────────────────────────────────────────────╯
╭────────────────────────────────────────────────╮
│ Design points 1 settled, 2 to go               │
│ 14:05 ✔ D1 Where carts are kept                │
│         Decision: On the server, one row per   │
│         cart                                   │
│ 14:05 ◼ D2 When a cart expires                 │
│ 14:05 ◻ D3 What a guest sees                   │
╰────────────────────────────────────────────────╯
```

And across the window, above the prompt:

```
14:05 ✔ P1 saved carts #142 · ■■■□□ 3/5 CI tests running · unit tests passed, end-to-end running
```

Every entry shows the time it last changed and carries a label (`T3`, `Q2`, `A1`, `D2`, `P1`) that
stays with it and is never reused, so you can name an entry in a prompt ("do T3 next", "reopen
D1"). When a prompt names a label, the mod hands Claude what it stands for.

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

### What you need

Claude Code 2.1.286 or newer. On an older version the board does not load at all, and nothing says
why; `claude --version` shows which one you have. A session that has been open for a while runs
the version it started on, so restart it after updating.

Mods are an early-access part of Claude Code and still change between releases, so the board may
need an update when Claude Code moves on.

## Installing

Run these in a terminal:

```
claude plugin marketplace add kpothos/ClaudeKPMods
claude plugin install sticky-board@claude-mods
```

Or type this at the prompt of a Claude Code session:

```
/plugin install sticky-board --marketplace kpothos/ClaudeKPMods
```

A session that was already open picks the board up after `/reload-plugins`.

Remove it again with `claude plugin uninstall sticky-board@claude-mods`.

## Questions and problems

Open an issue on this repo. Pull requests from other people are turned off.

## Working on a mod

Each mod lives in its own folder under `mods/`.

```
ClaudeKPMods/
├── .claude-plugin/marketplace.json   lists the mods, so they can be installed from this repo
└── mods/
    └── sticky-board/
        ├── .claude-plugin/plugin.json   the mod's name, version and description
        ├── hooks/hooks.json             names the file that holds the mod's code
        ├── hooks/register.tsx           the mod's code
        ├── types/index.d.ts             the values the mod keeps for a session
        └── tests/                       the mod's tests
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
claude plugin validate mods/sticky-board
claude plugin test mods/sticky-board
```
