# sticky-board

A board pinned beside your Claude Code conversation: tasks, open questions, answered questions, design points,
your own notes, and the pull requests Claude is taking through to release.

## The problem

In a long Claude Code session, the things you need to keep hold of scroll away.

- Claude asks you three questions, then writes two more screens, and the questions are gone.
- You ask something and get a good answer. Twenty minutes later you are scrolling back to find it.
- On a bigger plan it gets worse. There is a task list, a few design points you have not settled
  yet and a pull request part-way to release, all of it somewhere above you in the conversation.

So you scroll back, again and again, and lose your place each time.

## What it does

sticky-board pins those things on screen. They stay put while the conversation moves on, and
Claude keeps them up to date as it works.

![sticky-board in a real Claude Code session. Beside the conversation, the board shows boxes for
tasks, open questions, answered questions and design points, with older entries scrolled out of
view. Above the prompt, a strip shows the session's pull requests, all of them
live.](https://raw.githubusercontent.com/kpothos/ClaudeKPMods/main/media/sticky-board.png)

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
│ Open questions 1 · ○ answered · ↑ scroll back  │
│ 14:05 ○ ↑ Q1 Should a saved cart expire after  │
│           30 days?                             │
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
╭────────────────────────────────────────────────╮
│ Notes 1 · press ○ to remove                    │
│ 14:06 ○ N1 Ask the team about the guest limit  │
╰────────────────────────────────────────────────╯
```

And across the window, above the prompt:

```
14:05 ✔ P1 saved carts #142 · ●━●━◉━○━○ CI tests running · unit tests passed, end-to-end running
```

Every entry shows the time it last changed and carries a label (`T3`, `Q2`, `A1`, `D2`, `N1`, `P1`)
that stays with it and is never reused, so you can name an entry in a prompt ("do T3 next", "reopen
D1"). When a prompt names a label, the mod hands Claude what it stands for.

In the panel, each box with its own scrolling list:

- **Tasks.** Claude keeps its task list here with a tool the mod adds. Tasks made with the
  built-in task tools, in sessions that have them, show up too.
- **Open questions.** Claude adds the questions it leaves for you and takes them off once you
  answer. A question you dismiss in a question dialog stays on the board. If Claude ends a reply
  on a question without adding it, the mod adds it. Press the `○` beside a question to take it off
  yourself, or the `↑` to scroll the conversation back to where Claude asked it (fullscreen mode).
  When auto mode blocks something Claude tried to do, it shows up here too, so you know
  to approve it in `/permissions` (under Recently denied). It comes off by itself once that action
  goes through, or press its `○`.
- **Answered.** The questions you asked, each with a short version of Claude's answer, so the
  answer stays in view after the full reply has scrolled away. Press `○` to check an entry off, or
  the `↑` beside the answer to scroll the conversation back to the full one (fullscreen mode). The
  newest 30 are kept.
- **Design points.** The points of a plan that still need deciding, in the plan's order: not
  settled yet, being discussed, or settled with the decision in a line or two. Claude takes them
  one at a time and marks one settled only when you have agreed. The box is drawn only while there
  are design points. Claude also writes each decision into the plan itself.
- **Notes.** Your own notes, which only you add: type `/sticky note <text>`. Press `○` to remove
  one. The board does not tell Claude about them unless a prompt names one by its label. The
  newest 30 are kept, and the box is drawn only while there are notes.

Across the window, in the strip above the prompt:

- **Pull requests.** One row for each pull request Claude is taking through to release: the stage
  it is at (pre-PR tests, PR open, CI tests, merge and deploy, live), a `✔` or `✖` for whether
  everything is fine, and a few words on why. The stages are five dots: green for the ones passed,
  yellow for the one it is at (green once live, red when something is wrong), gray for the rest.
  Claude reports these as it goes; the mod does not check GitHub itself. The newest 2 are kept.
  The strip is drawn only while there are pull requests.

Where the panel sits: beside the conversation in fullscreen mode from 110 columns, above the prompt
otherwise. It opens by itself in a wide window (144 columns, or 110 once you have opened it
yourself); `/sticky` opens it at any width. Above the prompt the boxes sit side by side, so only
the ones with something in them are drawn. In the desktop app, a panel you shrink to a small
widget shows a one-line summary instead.

Scrolling: the mouse wheel scrolls the box under the pointer. A box with more than fits shows
`▲ n more lines` and `▼ n more lines`, which you can click, or reach with ctrl+x tab, Tab and Enter.
A panel too short to give every box a row scrolls as one.

`/clear` empties the board and starts the labels again from 1. When you resume a conversation
(`claude --resume`, `claude --continue`, or `/resume`), its board comes back, labels and all. After
a `/resume` typed inside a session, it comes back with your first message there (or your first
`/sticky`). How the board is
kept is under Privacy, below.

## Try it

Install it (below), start a session in a project, and try prompts like these:

- "Let's add saved carts to checkout. Plan it with me, one design point at a time."
- "Fix the failing login test, then take the fix through to a pull request and tell me where it
  stands at each step."
- "Why does the app read the config twice at startup?" (Then press the `↑` beside the answer to
  jump back to the full reply.)

And pin a note of your own with `/sticky note Ask the team about the guest limit`.

## Privacy

The mod makes no network calls of its own, and fetches nothing. What it adds to Claude's
instructions and to your messages goes to Claude with the rest of the conversation, in the same
requests Claude Code already sends. That is all of it:

- **Claude's instructions.** At the start of a conversation it adds a short section telling Claude
  to keep the board up to date with the five tools the mod adds. In the desktop app, where the
  board is not on screen yet when a conversation starts, the same text goes with your next message
  instead, once.
- **Your messages.** While the board has open questions or design points still to settle, each
  message you send carries a short list of them for Claude, so it can tell which ones your message
  answers. When a message names a label such as `T3` or `N1`, it carries what that entry says.
- **Your notes.** The board does not send them to Claude unless a message names one by its label.
  The `/sticky note` command you type is kept in the conversation like any other command, so Claude
  can read that.
- **Claude's replies.** When a reply ends on a question that Claude did not put on the board, the
  mod reads the reply's last paragraph and adds the question itself. So that the question's `↑` can
  find the reply, the mod notes which row of the conversation holds the reply's text: its id only.
- **What it keeps on your computer.** When a conversation ends (an exit, a `/clear`, a `/resume`),
  its board is saved in Claude Code's own storage for this mod, a file under `~/.claude/plugins/`,
  so that resuming the conversation brings it back. The boards of the 20 most recent conversations
  are kept and older ones are deleted. A board too large to keep (over 150,000 characters, where a
  usual one is a few thousand) is not saved.

## What the mod's code does inside Claude Code

The mod is one file of code, `hooks/register.tsx`, that Claude Code runs. It uses Claude Code's own
storage for this mod and nothing else: no network, no files of yours, no programs. These are all the
places it hooks into, and what each one does:

- **Starting a session** (`session.start`): adds the `/sticky` command and the board's five tools,
  brings back the board of a conversation you resumed, and opens the panel.
- **Ending a session** (`session.end`): saves the board for a resume (see Privacy). After `/clear` or
  `/resume` it also empties the board.
- **The `/sticky` command** (`command.run`, for `sticky` only): opens the board, or pins a note with
  `/sticky note <text>`. The mod answers this command itself and touches no other command.
- **Its own five tools** (`tool.call`, for `mcp__sticky-board__tasks`, `mcp__sticky-board__questions`,
  `mcp__sticky-board__answered`, `mcp__sticky-board__prs` and `mcp__sticky-board__design` only): the
  mod's `tool.call` hook returns the result of these five tools itself, every time they are called,
  because they are the mod's own tools and have nothing else behind them. It returns a result of its
  own for no other tool. A call from a subagent is answered "Only the main conversation keeps the
  sticky board" and changes nothing.
- **The built-in task tools** (`tool.call`, for `TaskCreate` and `TaskUpdate`): returns what `next`
  gives back, so the call runs and answers unchanged; afterwards the mod copies the task onto the
  board.
- **The question dialog** (`tool.call`, for `AskUserQuestion`): returns what `next` gives back, so the
  dialog runs and answers unchanged; the mod puts its questions on the board first and takes off the
  ones you answered.
- **Auto mode refusing an action** (`classic.PermissionDenied`): the mod reads the refused tool's name
  and input to show the action under Open questions. What it changes: nothing. It returns what
  `next` gives back, so the refusal stands as it was.
- **A tool having run** (`classic.PostToolUse`, `classic.PostToolUseFailure`): the mod reads the tool's
  name and input to take a refused action off the board once it has gone through. What it changes:
  nothing. It returns what `next` gives back.
- **Claude's instructions** (`prompt.compose`): adds the board's section at the end (its text is
  `RULE` in `hooks/register.tsx`) and leaves the rest as it is.
- **Your messages** (`prompt.submit`): adds the notes described under Privacy alongside your message.
  Your own words are never changed. It also brings back the board of a conversation you resumed.
- **The start and end of Claude's turn** (`turn.start`, `turn.complete`): counts the questions put on
  the board, and at the end reads the reply's last paragraph for a question left off it. The reply
  is not changed.
- **Each row added to the conversation** (`session.append`): looks at whether the row is Claude's
  reply with text in it and, if so, keeps the row's id until the turn ends, for the `↑` of a
  question picked out of that reply. For a question from a question dialog or a refused action, it
  also notes the id of the row with that call's outcome, which is where the conversation shows it.
  What it changes: nothing. It returns what `next` gives back, so every row is kept as it was.
- **Drawing and scrolling** (`ui.render`, `ui.scroll`): draws its own panel and its own pull-request
  row, and scrolls the box under the pointer in its own panel. A press on a `↑` scrolls the
  conversation back to that entry's row.

## At work: Claude Code managed by your organization

This applies when your organization manages Claude Code on your computer (managed settings), or
when you sign in with a Team or Enterprise account. There, Claude Code does not let a mod you
installed yourself add to Claude's instructions; only plugins your organization installs can.

What still works:

- Everything you see and do on the board: the boxes, `/sticky`, `/sticky note`, the `○` and `↑`
  marks, scrolling, and the board coming back when you resume a conversation.
- The five tools Claude uses to keep the board, each with its own description.
- The short list of open questions and design points that goes with each of your messages, and
  what a label such as `T3` stands for when you name it.
- Questions Claude ends a reply on, which the mod still adds to the board itself.

What does not:

- The section of Claude's instructions that tells Claude to keep the board. Without it, Claude
  uses the board only when it decides to, so the boxes fill in less.

What you can do:

- Ask Claude yourself, for example at the start of a conversation: "Keep my sticky board up to
  date as you work: your task list, the questions you leave me, short answers to my questions,
  design points and pull requests."
- Ask your administrator to install the board for your organization. In the organization's managed
  settings, they enable `sticky-board@claude-mods` in `enabledPlugins`, add the marketplace
  `kpothos/ClaudeKPMods` to `extraKnownMarketplaces`, and list the plugin in `prependPlugins` or
  `appendPlugins`. Installed that way it counts as the organization's own, and it adds its
  instructions as usual.
- If your organization allows only plugins it has approved, the board cannot be installed until
  your administrator approves it.

## What you need

Claude Code 2.1.286 or newer. On an older version the board does not load at all, and nothing says
why; `claude --version` shows which you have. A session that has been open for a while runs the version
it started on, so restart it after updating.

It works in the terminal and in the Code tab of the Claude desktop app. In VS Code the panel works,
but the pull-request strip is not shown. It does not run in chats on claude.ai.

Mods are an early-access part of Claude Code and still change between releases, so the board may
need an update when Claude Code moves on.

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

A session that was already open picks the board up after `/reload-plugins`.

Remove it again with `claude plugin uninstall sticky-board@claude-mods`.

## Questions and problems

Open an issue at https://github.com/kpothos/ClaudeKPMods/issues.

## License

MIT: free for anybody to use, copy and change. The full text is in [LICENSE](LICENSE).
