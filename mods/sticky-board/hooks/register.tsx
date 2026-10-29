import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  Answers,
  DesignPoint,
  DesignPoints,
  DesignState,
  Offsets,
  PrStage,
  PullRequest,
  PullRequests,
  Question,
  Questions,
  Task,
  Tasks,
  TaskStatus,
} from '../types'

// Columns a row spends before its text: "16:21 ", the mark and a space.
const LEAD = 8
// Rows a box spends beside its list: the border's two and the title.
const CHROME = 3
// The most rows the board takes above the prompt, where a taller one crowds the transcript.
const INLINE_ROWS = 10
// How many answered questions the board keeps: the oldest leave first.
const KEPT_ANSWERS = 30
// And how many pull requests: each is a row above the prompt, so the strip stays two rows at most.
const KEPT_PRS = 2
// How much of a refused action the board shows: /permissions has the whole of it.
const SHOWN_ACTION = 80

const RANK: Record<TaskStatus, number> = { in_progress: 0, pending: 1, completed: 2 }
const MARK: Record<TaskStatus, string> = { in_progress: '◼', pending: '◻', completed: '✔' }
const MARK_COLOR: Record<TaskStatus, string> = {
  in_progress: 'claude',
  pending: 'inactive',
  completed: 'success',
}

const POINT_MARK: Record<DesignState, string> = { discussing: '◼', unsettled: '◻', settled: '✔' }
const POINT_COLOR: Record<DesignState, string> = {
  discussing: 'claude',
  unsettled: 'inactive',
  settled: 'success',
}

// Theme keys rather than fixed colors, so each box keeps its blue, orange, green or purple in a light or dark theme.
const BOX_COLOR: Record<keyof Offsets, string> = {
  tasks: 'ide',
  questions: 'claude',
  answers: 'success',
  design: 'merged',
}

const STAGES: readonly PrStage[] = ['pre_pr', 'open', 'ci', 'deploy', 'live']
const STAGE_LABEL: Record<PrStage, string> = {
  pre_pr: 'Pre-PR: running the test suites',
  open: 'PR open',
  ci: 'CI tests running',
  deploy: 'Merging and deploying',
  live: 'Live',
}

const RULE = `# Sticky board
The user keeps a board on screen: Tasks, Open questions, Answered, Design points and Pull requests. Keeping them right is your job:
- mcp__sticky-board__tasks: for any work of more than a couple of steps, put your task list on the board before you start, and send it again each time a task starts or finishes, so the board always shows where you are. If you also have TaskCreate and TaskUpdate, tasks made with those reach the board by themselves: use one or the other, never both for the same task.
- mcp__sticky-board__questions: when your reply asks the user something you need answered, or leaves a decision to them, add each one, worded so that it makes sense on its own. When the user has answered one, or it no longer matters, resolve it by its id. When auto mode blocks one of your actions, the board shows it to the user by itself: do not add a question for it.
- mcp__sticky-board__answered: when the user asks you a question and you answer it, record it just before you write your answer: their question in a few words and your answer in one or two plain sentences, so they can still see it after your reply has scrolled away. A request to do work is not a question to record.
- mcp__sticky-board__prs: when you are taking a pull request through to release, report it each time it moves or its health changes: \`stage\` is pre_pr (running every test suite before opening it), open (the pull request is open), ci (CI is running on it), deploy (merged and deploying) or live; \`ok\` says whether everything is fine, and \`status\` says why in a few words. Keep the same \`name\` for it from start to finish.
- mcp__sticky-board__design: when a plan has design points that are not settled yet, list them, in the plan's order, and send the whole list again each time one changes. Take them one at a time: mark the one you and the user are talking through as discussing, and keep the discussion to it. Mark a point settled only when the user has clearly agreed, and give the decision in a line or two; write the decision into the plan itself as well, since the board is cleared with the conversation. Then take the next unsettled point.
Every entry on the board carries a label the user can see: T3 for a task, Q2 for an open question, A1 for an answered one, D2 for a design point, P1 for a pull request. The user may name an entry by its label; what the label stands for then comes with their message.
Do not add rhetorical questions, and do not mention the board unless the user asks about it.`

const TOOLS = [
  'mcp__sticky-board__tasks',
  'mcp__sticky-board__questions',
  'mcp__sticky-board__answered',
  'mcp__sticky-board__prs',
  'mcp__sticky-board__design',
]

// A subagent's own steps and asides are not the user's business: only the main conversation keeps the board.
const NOT_MAIN = 'Only the main conversation keeps the sticky board; nothing was changed.'
// The two sources of tasks keep their ids apart, so neither can touch the other's entries.
const OWN = 'board:'
const BUILT_IN = 'task:'

// Kept under a tag: a session that kept these in an older form (plain lists, entries with no
// label number) reads them as absent, and the board starts those boxes empty.
const tasks = atom({ plugin: 'sticky-board', key: 'tasks' } as const, { seq: 0, list: [] }, {
  shape: 'numbered',
})
const questions = atom({ plugin: 'sticky-board', key: 'questions' } as const, {
  seq: 0,
  open: [],
})
const answers = atom({ plugin: 'sticky-board', key: 'answers' } as const, { seq: 0, list: [] }, {
  shape: 'numbered',
})
const prs = atom({ plugin: 'sticky-board', key: 'prs' } as const, { seq: 0, list: [] }, {
  shape: 'numbered',
})
const design = atom({ plugin: 'sticky-board', key: 'design' } as const, { seq: 0, list: [] }, {
  shape: 'numbered',
})
const TOP: Offsets = { tasks: 0, questions: 0, answers: 0, design: 0 }
const offsets = atom({ plugin: 'sticky-board', key: 'scroll' } as const, TOP)
// A session keeps its values across an update of the mod: offsets kept by a version with fewer
// boxes lack the newer ones, which start at the top.
const whole = (value: Offsets): Offsets => ({ ...TOP, ...value })

// The boxes in the order they are drawn.
const ORDER: readonly (keyof Offsets)[] = ['tasks', 'questions', 'answers', 'design']

type BoxName = keyof Offsets

type Line = {
  lead: string
  mark: string
  color: string
  text: string
  isDim: boolean
  isBold: boolean
  // A mark the person can press, drawn in the mark's place.
  press?: { key: string; label: string; run: () => unknown }
}

type BoxSpec = { name: BoxName; title: string; note: string; empty: string; lines: Line[] }

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high)

const clock = (at: number): string => {
  const date = new Date(at)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return `${hours}:${minutes}`
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []

const isStatus = (value: unknown): value is TaskStatus =>
  typeof value === 'string' && Object.hasOwn(RANK, value)

const isStage = (value: unknown): value is PrStage =>
  typeof value === 'string' && Object.hasOwn(STAGE_LABEL, value)

// The design points of a call, or nothing when any of them is unusable: a list taken in part
// would drop points from the board without saying so.
const sentPoints = (value: unknown): Pick<DesignPoint, 'topic' | 'state' | 'decision'>[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined
  }

  const points = value.flatMap(
    (one: { topic?: unknown; state?: unknown; decision?: unknown } | null) => {
      if (one === null || typeof one !== 'object' || typeof one.topic !== 'string') {
        return []
      }

      const topic = one.topic.trim()
      const decision = typeof one.decision === 'string' ? one.decision.trim() : ''
      const { state } = one

      if (topic === '' || typeof state !== 'string' || !Object.hasOwn(POINT_MARK, state)) {
        return []
      }

      // A decision belongs to a settled point alone, and a settled point has to have one.
      return state === 'settled'
        ? decision === ''
          ? []
          : [{ topic, state: 'settled' as const, decision }]
        : [{ topic, state: state as DesignState, decision: '' }]
    },
  )

  return points.length === value.length ? points : undefined
}

const sentTasks = (value: unknown): Pick<Task, 'subject' | 'status'>[] =>
  (Array.isArray(value) ? value : []).flatMap(
    (one: { subject?: unknown; status?: unknown } | null) =>
      one !== null &&
      typeof one === 'object' &&
      typeof one.subject === 'string' &&
      one.subject.trim() !== '' &&
      isStatus(one.status)
        ? [{ subject: one.subject.trim(), status: one.status }]
        : [],
  )

// The board wraps its own text: a box scrolls by rows, so it has to know how many each entry takes.
const wrap = (text: string, columns: number): string[] => {
  const lines: string[] = []
  let line = ''

  for (const word of text.split(/\s+/).filter(Boolean)) {
    // By character, not by code unit: a cut through the middle of an emoji leaves two broken halves.
    let rest = Array.from(word)

    while ((line === '' ? rest.length : line.length + 1 + rest.length) > columns) {
      if (line === '') {
        lines.push(rest.slice(0, columns).join(''))
        rest = rest.slice(columns)
      } else {
        lines.push(line)
        line = ''
      }
    }

    line = line === '' ? rest.join('') : `${line} ${rest.join('')}`
  }

  // An entry with no words still takes a row: it is counted in the title, so it has to show.
  return line === '' && lines.length > 0 ? lines : [...lines, line]
}

const windowOf = (count: number, room: number, offset: number) => {
  // A box of one or two rows has none to spare for the "more lines" marks: it shows entries only.
  const hasMarks = room >= 3
  // With marks, a row past the top goes to the "more above" mark, so the last page starts one row later.
  const max = count > room ? count - room + (hasMarks ? 1 : 0) : 0
  const first = clamp(offset, 0, max)
  const above = hasMarks ? first : 0
  let shown = room - (above > 0 ? 1 : 0)
  const hasBelow = hasMarks && first + shown < count

  if (hasBelow) {
    shown -= 1
  }

  shown = clamp(shown, 0, count - first)
  const below = hasBelow ? count - first - shown : 0

  return {
    first,
    shown,
    above,
    below,
    max,
    // An empty box still shows one row saying so.
    rows: Math.max(shown, count === 0 ? 1 : 0) + (above > 0 ? 1 : 0) + (below > 0 ? 1 : 0),
  }
}

// Stacked boxes share the rows: the short ones take what they need and the long ones split the rest.
const share = (needs: readonly number[], total: number): number[] => {
  const rooms = needs.map(() => 1)
  const waiting = needs.map((_, index) => index).sort((a, b) => (needs[a] ?? 0) - (needs[b] ?? 0))
  let left = total

  waiting.forEach((index, place) => {
    const fair = Math.floor(left / (waiting.length - place))
    const room = clamp(needs[index] ?? 1, 1, Math.max(1, fair))
    rooms[index] = room
    left -= room
  })

  return rooms
}

const addTo = (value: Questions, texts: readonly string[], at: number): Questions => {
  const open = [...value.open]
  let seq = value.seq

  for (const raw of texts) {
    const text = raw.trim()

    // A refused action worded the same is not this question: it leaves the board on its own terms.
    if (text !== '' && !open.some(one => one.blocked === undefined && one.text === text)) {
      seq += 1
      open.push({ id: `q${seq}`, text, at })
    }
  }

  return { seq, open }
}

const addQuestions = async ($: EngineInterface, texts: readonly string[]) => {
  const at = await $.clock.now()

  return update($, questions, value => addTo(value, texts, at))
}

// The questions a reply ends on: the sentences of its last paragraph that end with a question mark.
const closingQuestions = (answer: string): string[] => {
  const units: string[] = []

  for (const line of (answer.trim().split(/\n\s*\n/).at(-1) ?? '').split('\n')) {
    const item = line.replace(/^\s*(?:[-*+>]|\d+[.)])\s+/, '')

    // A line with no list mark of its own carries on the sentence of the line before it.
    if (item === line && units.length > 0) {
      units[units.length - 1] += ` ${line.trim()}`
    } else {
      units.push(item)
    }
  }

  return (
    units
      // A sentence ends at its mark, or at the quote or bracket closing it; the full stop inside
      // "e.g." and the like ends nothing.
      .flatMap(unit => unit.split(/(?<=[.!?]["'”’)]*)(?<!\b(?:e\.g|i\.e|etc|vs)\.)\s+/))
      .map(sentence => sentence.replace(/^[*_"'“”‘’\s]+|[*_"'“”‘’)\s]+$/g, ''))
      .filter(sentence => sentence.endsWith('?'))
  )
}

// The tools whose calls the engine tells apart by their command alone.
const SHELLS: readonly string[] = ['Bash', 'PowerShell']

// Which action a call is, as the engine's own list of auto mode's refusals tells them apart: a
// shell command by its text alone (the model words its description afresh each try), any other
// call by its whole input.
const actionKey = (tool: string, input: unknown): string => {
  const { command } = (input ?? {}) as { command?: unknown }

  return SHELLS.includes(tool) && typeof command === 'string'
    ? command
    : JSON.stringify(input ?? null)
}

// What the person reads of a refused action: its command, file or address, on one short line.
const shownAction = (tool: string, input: unknown): string => {
  const { command, file_path: file, url } = (input ?? {}) as Record<string, unknown>
  const shown = [command, file, url].find(
    (one): one is string => typeof one === 'string' && one.trim() !== '',
  )

  if (shown === undefined) {
    return tool
  }

  // By character, as in wrap: a cut through an emoji leaves two broken halves.
  const chars = Array.from(shown.replace(/\s+/g, ' ').trim())

  return `${tool}(${chars.length > SHOWN_ACTION ? `${chars.slice(0, SHOWN_ACTION - 1).join('')}…` : chars.join('')})`
}

// A refused action that has since run was approved, or a rule now lets it through: the person has
// nothing left to do about it.
const clearBlocked = async ($: EngineInterface, tool: string, input: unknown) => {
  const key = actionKey(tool, input)
  const isIt = (one: Question) => one.blocked?.tool === tool && one.blocked.key === key

  // Read first: this runs after every tool call, and a write for nothing draws the board again.
  if ((await read($, questions)).open.some(isIt)) {
    await update($, questions, value => ({
      ...value,
      open: value.open.filter(one => !isIt(one)),
    }))
  }
}

export const register: Register = on => {
  // What the last drawing looked like, for the hook that scrolls it: a drawing may not write
  // $.state, and a scroll event carries neither the pane's width nor where its boxes sit.
  let drawn: {
    bodyRows: number
    isRow: boolean
    isWhole: boolean
    names: BoxName[]
    ends: number[]
    max: Offsets
  } = { bodyRows: 0, isRow: false, isWhole: false, names: [], ends: [], max: TOP }
  let seqAtTurnStart = -1
  // How many refused actions went on the board since then: they move the question count too, and
  // are not questions the model asked.
  let blockedAdds = 0

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sticky',
      description: 'Show the sticky board: tasks, open questions, answers and design points',
    })
    await $.tool.register({
      name: 'tasks',
      description:
        "Sets the Tasks box of the user's sticky board to your current task list. Send the whole list every time, in order, each task with its `subject` and its `status`; a task you leave out is taken off the board.",
      inputSchema: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                subject: { type: 'string' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
              },
              required: ['subject', 'status'],
            },
          },
        },
        required: ['tasks'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'questions',
      description:
        "Keeps the Open questions box of the user's sticky board right. `add`: questions you have asked the user and still need answered, each worded to make sense on its own. `resolve`: the ids of open questions the user has answered or that no longer matter. Answers with the questions still open and their ids.",
      inputSchema: {
        type: 'object',
        properties: {
          add: { type: 'array', items: { type: 'string' } },
          resolve: { type: 'array', items: { type: 'string' } },
        },
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'answered',
      description:
        "Adds one entry to the Answered box of the user's sticky board: a question the user asked you, and the answer you are giving. `question`: their question in a few words. `answer`: your answer in one or two plain sentences, complete enough to be useful on its own. Call it just before you write the full answer.",
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          answer: { type: 'string' },
        },
        required: ['question', 'answer'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'prs',
      description:
        "Reports one pull request you are taking through to release, for the Pull requests box of the user's sticky board. `name`: a short name, the same at every stage. `stage`: pre_pr (running every test suite before opening it), open, ci, deploy or live. `ok`: whether everything is fine. `status`: why, in a few words. `number`: the pull request's number once it has one. `remove`: true takes it off the board.",
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          number: { type: 'integer' },
          stage: { type: 'string', enum: ['pre_pr', 'open', 'ci', 'deploy', 'live'] },
          ok: { type: 'boolean' },
          status: { type: 'string' },
          remove: { type: 'boolean' },
        },
        required: ['name'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'design',
      description:
        "Sets the Design points box of the user's sticky board: the design points of the plan you are working out with the user. Send the whole list every time, in the plan's order, each point with its `topic` and its `state`: unsettled, discussing (the one you and the user are talking through now) or settled. A settled point needs its `decision`, in a line or two. A point you leave out is taken off the board.",
      inputSchema: {
        type: 'object',
        properties: {
          points: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                topic: { type: 'string' },
                state: { type: 'string', enum: ['unsettled', 'discussing', 'settled'] },
                decision: { type: 'string' },
              },
              required: ['topic', 'state'],
            },
          },
        },
        required: ['points'],
      },
      isDeferred: false,
    })
    void $.ui.open({ id: 'sticky-board', title: 'Sticky board' }).then(opened => {
      if (!opened.isPlaced) {
        $.ui.toast('The sticky board is hidden in a narrow window. Type /sticky to show it.')
      }
    })

    return next(e)
  })

  on('command.run', { command: 'sticky' }, async $ => {
    await $.ui.open({ id: 'sticky-board', title: 'Sticky board' })

    return { text: 'Sticky board opened.' }
  })

  on('session.end', async ($, e, next) => {
    // The process goes on with another conversation, which the old one's board says nothing about.
    if (e.reason === 'clear' || e.reason === 'resume') {
      await update($, tasks, () => ({ seq: 0, list: [] }))
      await update($, questions, () => ({ seq: 0, open: [] }))
      await update($, answers, () => ({ seq: 0, list: [] }))
      await update($, prs, () => ({ seq: 0, list: [] }))
      await update($, design, () => ({ seq: 0, list: [] }))
      await update($, offsets, () => TOP)
    }

    return next(e)
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)

    if (ran.deny !== undefined || ran.isError === true) {
      return ran
    }

    const id = `${BUILT_IN}${ran.result.task.id}`
    const { subject } = ran.result.task
    const at = await $.clock.now()
    await update($, tasks, ({ seq, list }): Tasks => {
      const n = list.find(task => task.id === id)?.n ?? seq + 1

      return {
        seq: Math.max(seq, n),
        list: [...list.filter(task => task.id !== id), { id, n, subject, status: 'pending', at }],
      }
    })

    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)

    if (ran.deny !== undefined || ran.isError === true || !ran.result.success) {
      return ran
    }

    const id = `${BUILT_IN}${e.taskId}`
    const at = await $.clock.now()
    await update($, tasks, ({ seq, list }): Tasks => {
      if (e.status === 'deleted') {
        return { seq, list: list.filter(task => task.id !== id) }
      }

      // A task made before the board loaded is first heard of here, without its subject.
      const old = list.find(task => task.id === id)
      const status = e.status ?? old?.status ?? 'pending'
      const changed: Task = {
        id,
        n: old?.n ?? seq + 1,
        subject: e.subject ?? old?.subject ?? `Task ${e.taskId}`,
        status,
        at: old !== undefined && old.status === status ? old.at : at,
      }

      return old === undefined
        ? { seq: seq + 1, list: [...list, changed] }
        : { seq, list: list.map(task => (task.id === id ? changed : task)) }
    })

    return ran
  })

  on('tool.call', { tool: 'mcp__sticky-board__tasks' }, async ($, e) => {
    if (e.agentId !== undefined) {
      return { result: NOT_MAIN }
    }

    const sent = sentTasks(e.tasks)
    const at = await $.clock.now()
    const { list } = await update($, tasks, (value): Tasks => {
      // Each old entry lends its label and time to one new entry only, so two tasks of one name keep their own.
      const old = value.list.filter(task => task.id.startsWith(OWN))
      let { seq } = value
      const own = sent.map(({ subject, status }, index): Task => {
        // By subject, not by place: a task added in the middle leaves the labels and times of the rest alone.
        const found = old.findIndex(task => task.subject === subject)
        const [same] = found === -1 ? [] : old.splice(found, 1)
        const n = same?.n ?? (seq += 1)

        return { id: `${OWN}${index}`, n, subject, status, at: same?.status === status ? same.at : at }
      })

      return { seq, list: [...value.list.filter(task => !task.id.startsWith(OWN)), ...own] }
    })
    const own = list.filter(task => task.id.startsWith(OWN))

    return {
      result: [
        `The board shows ${own.length} ${own.length === 1 ? 'task' : 'tasks'}.`,
        ...own.map(task => `T${task.n} [${task.status}] ${task.subject}`),
      ].join('\n'),
    }
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    // On the board before the dialog opens, so a question the person dismisses stays there.
    await addQuestions(
      $,
      e.questions.map(one => one.question),
    )
    const ran = await next(e)

    if (ran.deny !== undefined || ran.isError === true) {
      return ran
    }

    const picked: Record<string, unknown> = ran.result.answers
    // Typed in place of a pick, the person's own words answer the one question that was asked.
    const isTyped = e.questions.length === 1 && (ran.result.response ?? '').trim() !== ''
    const answered = e.questions
      // A blank answer leaves the question open; a 0 picked on a number question does not.
      .filter(one => isTyped || String(picked[one.question] ?? '').trim() !== '')
      .map(one => one.question.trim())
    await update($, questions, value => ({
      ...value,
      // A refused action worded like the question is not answered by it.
      open: value.open.filter(one => one.blocked !== undefined || !answered.includes(one.text)),
    }))

    return ran
  })

  on('tool.call', { tool: 'mcp__sticky-board__questions' }, async ($, e) => {
    if (e.agentId !== undefined) {
      return { result: NOT_MAIN }
    }

    const add = strings(e.add)
    // The board shows Q2 where the id is q2: either spelling names the question.
    const resolve = strings(e.resolve).map(id => id.trim().toLowerCase())
    const at = await $.clock.now()
    const { open } = await update($, questions, value =>
      addTo(
        {
          ...value,
          // A refused action leaves once it runs or the person presses its ○, not on the model's word.
          open: value.open.filter(
            one => one.blocked !== undefined || !resolve.includes(one.id.toLowerCase()),
          ),
        },
        add,
        at,
      ),
    )
    const asked = open.filter(one => one.blocked === undefined)

    return {
      result:
        asked.length === 0
          ? 'No open questions.'
          : asked.map(one => `${one.id.toUpperCase()}: ${one.text}`).join('\n'),
    }
  })

  // NOTE: a subagent's refused action goes on the board too, unlike its other steps: only the
  // person can approve it, whichever loop asked.
  on('classic.PermissionDenied', async ($, e, next) => {
    const blocked = { tool: e.tool_name, key: actionKey(e.tool_name, e.tool_input) }
    const text = `Auto mode blocked ${shownAction(e.tool_name, e.tool_input)}. Approve it in /permissions.`
    const at = await $.clock.now()
    let added = 0
    await update($, questions, value => {
      // Set by the run that is written: update runs this again when another write came first.
      added = 0

      const isThere = value.open.some(
        one => one.blocked?.tool === blocked.tool && one.blocked.key === blocked.key,
      )

      if (isThere) {
        return value
      }

      added = 1
      const seq = value.seq + 1

      return { seq, open: [...value.open, { id: `q${seq}`, text, at, blocked }] }
    })
    blockedAdds += added

    return next(e)
  })

  // Either one means the tool ran, so whatever refused it before has since let it through.
  on('classic.PostToolUse', async ($, e, next) => {
    await clearBlocked($, e.tool_name, e.tool_input)

    return next(e)
  })

  on('classic.PostToolUseFailure', async ($, e, next) => {
    await clearBlocked($, e.tool_name, e.tool_input)

    return next(e)
  })

  on('tool.call', { tool: 'mcp__sticky-board__answered' }, async ($, e) => {
    if (e.agentId !== undefined) {
      return { result: NOT_MAIN }
    }

    const question = typeof e.question === 'string' ? e.question.trim() : ''
    const answer = typeof e.answer === 'string' ? e.answer.trim() : ''

    if (question === '' || answer === '') {
      return { result: 'Nothing was added: an entry needs both a question and an answer.' }
    }

    const at = await $.clock.now()
    // The call's own row sits beside the full answer in the transcript: a press on the entry scrolls back to it.
    const rowId = e.tool_use_id
    const { list } = await update($, answers, (value): Answers => {
      // Asked again, a question keeps its label and takes the new answer.
      const n = value.list.find(one => one.question === question)?.n ?? value.seq + 1

      return {
        seq: Math.max(value.seq, n),
        list: [
          ...value.list.filter(one => one.question !== question),
          { n, rowId, question, answer, at },
        ].slice(-KEPT_ANSWERS),
      }
    })

    return { result: `Added to the Answered box as A${list.at(-1)?.n}.` }
  })

  on('tool.call', { tool: 'mcp__sticky-board__prs' }, async ($, e) => {
    if (e.agentId !== undefined) {
      return { result: NOT_MAIN }
    }

    // On one line: a pull request is drawn as a single row, which a line break inside its name would split.
    const name = typeof e.name === 'string' ? e.name.replace(/\s+/g, ' ').trim() : ''

    if (name === '') {
      return { result: 'Nothing was changed: a pull request needs a name.' }
    }

    if (e.remove === true) {
      await update($, prs, value => ({
        ...value,
        list: value.list.filter(one => one.name !== name),
      }))

      return { result: `${name} is off the board.` }
    }

    const { stage, ok: isOk } = e

    if (!isStage(stage) || typeof isOk !== 'boolean') {
      return {
        result:
          'Nothing was changed: `stage` must be pre_pr, open, ci, deploy or live, and `ok` must be true or false.',
      }
    }

    const status = typeof e.status === 'string' ? e.status.replace(/\s+/g, ' ').trim() : ''
    const sent = typeof e.number === 'number' && Number.isInteger(e.number) && e.number > 0
    const at = await $.clock.now()
    const { list } = await update($, prs, ({ seq, list: kept }): PullRequests => {
      const old = kept.find(one => one.name === name)
      // A number, once known, stays with the pull request when a later report leaves it out.
      const number = sent ? Number(e.number) : old?.number
      const changed: PullRequest = {
        n: old?.n ?? seq + 1,
        name,
        stage,
        isOk,
        status,
        at,
        ...(number === undefined ? {} : { number }),
      }

      return old === undefined
        ? { seq: seq + 1, list: [changed, ...kept].slice(0, KEPT_PRS) }
        : { seq, list: kept.map(one => (one.name === name ? changed : one)) }
    })

    return {
      result: `P${list.find(one => one.name === name)?.n} ${name}: stage ${STAGES.indexOf(stage) + 1} of ${STAGES.length} (${STAGE_LABEL[stage]}), ${isOk ? 'ok' : 'not ok'}.`,
    }
  })

  on('tool.call', { tool: 'mcp__sticky-board__design' }, async ($, e) => {
    if (e.agentId !== undefined) {
      return { result: NOT_MAIN }
    }

    const sent = sentPoints(e.points)

    if (sent === undefined) {
      return {
        result:
          'Nothing was changed: every point needs a `topic` and a `state` of unsettled, discussing or settled, and a settled point needs its `decision`.',
      }
    }

    const at = await $.clock.now()
    const { list } = await update($, design, (value): DesignPoints => {
      // Each old point lends its label and time to one new point only, as with the tasks.
      const old = [...value.list]
      let { seq } = value
      const points = sent.map(({ topic, state, decision }): DesignPoint => {
        const found = old.findIndex(one => one.topic === topic)
        const [same] = found === -1 ? [] : old.splice(found, 1)
        const n = same?.n ?? (seq += 1)

        const isSame = same?.state === state && same.decision === decision

        return { n, topic, state, decision, at: isSame ? same.at : at }
      })

      return { seq, list: points }
    })

    return {
      result: [
        `The board shows ${list.length} design ${list.length === 1 ? 'point' : 'points'}.`,
        ...list.map(
          one =>
            `D${one.n} [${one.state}] ${one.topic}${one.state === 'settled' ? `: ${one.decision}` : ''}`,
        ),
      ].join('\n'),
    }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    // Nobody reads a board in a run that draws nowhere, and a loop without the tools cannot follow the rule.
    if (e.surfaces.length === 0 || !TOOLS.every(tool => e.tools.includes(tool))) {
      return composed
    }

    return {
      sections: [
        ...composed.sections,
        { id: 'sticky-board:questions', text: RULE, scope: 'session' },
      ],
    }
  })

  on('prompt.submit', async ($, e, next) => {
    const isPerson =
      e.origin.kind === 'composer' ||
      e.origin.kind === 'bridge' ||
      e.origin.kind === 'sdk' ||
      e.origin.kind === 'slack-ping'

    if (!isPerson) {
      return next(e)
    }

    const notes: string[] = []
    // A refused action is the person's to approve in /permissions, not the model's to resolve.
    const open = (await read($, questions)).open.filter(one => one.blocked === undefined)

    // The model sees the open questions as the person replies, the moment it can tell which they answered.
    if (open.length > 0) {
      notes.push(
        [
          "Open questions on the user's sticky board:",
          ...open.map(one => `- ${one.id.toUpperCase()}: ${one.text}`),
          'If this message answers any of them, or one no longer matters, resolve it with mcp__sticky-board__questions.',
        ].join('\n'),
      )
    }

    const { list: points } = await read($, design)

    // While a point is still open the model gets the whole agenda with each reply, so a long
    // discussion of one point cannot lose the others.
    if (points.some(one => one.state !== 'settled')) {
      notes.push(
        [
          "Design points on the user's sticky board:",
          ...points.map(
            one =>
              `- D${one.n} [${one.state}] ${one.topic}${one.state === 'settled' ? `: ${one.decision}` : ''}`,
          ),
          'Keep the discussion to the point marked discussing. Mark a point settled only when the user has clearly agreed, with its decision, using mcp__sticky-board__design; then take the next unsettled point.',
        ].join('\n'),
      )
    }

    // The other labels the person reads off the board: where their message names one, what it stands for goes with it.
    const named = new Set((e.text.match(/\b[TAPD]\d+\b/gi) ?? []).map(label => label.toUpperCase()))

    if (named.size > 0) {
      const found = [
        ...(await read($, tasks)).list
          .filter(task => named.has(`T${task.n}`))
          .map(task => `- T${task.n}: the task "${task.subject}" (${task.status})`),
        ...(await read($, answers)).list
          .filter(one => named.has(`A${one.n}`))
          .map(one => `- A${one.n}: they asked "${one.question}" and your answer was "${one.answer}"`),
        ...(await read($, prs)).list
          .filter(one => named.has(`P${one.n}`))
          .map(
            one =>
              `- P${one.n}: the pull request "${one.name}"${one.number === undefined ? '' : ` #${one.number}`}, ${STAGE_LABEL[one.stage]}, ${one.isOk ? 'ok' : 'not ok'}${one.status === '' ? '' : `: ${one.status}`}`,
          ),
        ...points
          .filter(one => named.has(`D${one.n}`))
          .map(
            one =>
              `- D${one.n}: the design point "${one.topic}" (${one.state})${one.state === 'settled' ? `, decided: ${one.decision}` : ''}`,
          ),
      ]

      if (found.length > 0) {
        notes.push(
          ["Entries on the user's sticky board that this message names:", ...found].join('\n'),
        )
      }
    }

    return notes.length === 0 ? next(e) : next({ ...e, context: [...(e.context ?? []), ...notes] })
  })

  on('turn.start', async ($, e, next) => {
    // A subagent's turn starts inside the main one: counting from there would forget what the
    // main turn had already added.
    if (e.agentId !== undefined) {
      return next(e)
    }

    seqAtTurnStart = (await read($, questions)).seq
    blockedAdds = 0

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const isMainAnswer = e.agentId === undefined && e.reason === 'answer'

    // The check behind the rule: a reply that ends on a question nobody recorded still reaches the board.
    if (isMainAnswer && (await read($, questions)).seq - blockedAdds === seqAtTurnStart) {
      await addQuestions($, closingQuestions(e.answer))
    }

    return next(e)
  })

  on('ui.scroll', { requestId: 'sticky-board' }, async ($, e, next) => {
    // A change of height alone draws nothing again, so the last drawing may be for another height:
    // this move is the engine's, and the board is drawn again for the next one.
    if (e.bodyRows !== drawn.bodyRows) {
      $.ui.invalidate('ui.render')

      return next(e)
    }

    // Drawn whole in a dock too short for them, the boxes scroll as the pane does: the engine's move.
    if (drawn.isWhole) {
      return next(e)
    }

    const { pointer } = e
    const place = pointer === undefined ? -1 : drawn.isRow ? pointer.column : pointer.row
    // The wheel moves the box under it; the page keys, which point at nothing, move them all.
    const under = drawn.ends.findIndex(end => place < end)
    const aimed = pointer === undefined ? drawn.names : drawn.names.slice(under, under + 1)
    await update($, offsets, value => {
      const at = whole(value)
      const moved = { ...at }

      for (const name of under === -1 && pointer !== undefined ? drawn.names.slice(-1) : aimed) {
        // From where the box shows, not where it once stood: a list that got shorter leaves the kept offset past its end.
        moved[name] = clamp(Math.min(at[name], drawn.max[name]) + e.by, 0, drawn.max[name])
      }

      return moved
    })

    // Answered without next: the pane's own window stays put while a box moves its rows.
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: 'sticky-board' }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const { list } = await read($, tasks)
    const { open } = await read($, questions)
    const { list: answered } = await read($, answers)
    const { list: points } = await read($, design)
    const at = whole(await read($, offsets))

    // Side by side in the short block above the prompt, stacked in the tall dock beside the transcript.
    const isRow = e.props.placement === 'inline'
    const counts: Offsets = {
      tasks: list.length,
      questions: open.length,
      answers: answered.length,
      design: points.length,
    }
    // Side by side every box costs width, so there only the ones with something to show are drawn.
    const filled = ORDER.filter(name => counts[name] > 0)
    // Design points come and go with a plan: with none, their box is not drawn in the dock either.
    const docked = ORDER.filter(name => name !== 'design' || counts.design > 0)
    const names = !isRow ? docked : filled.length > 0 ? filled : ORDER.slice(0, 1)
    const boxColumns = isRow ? Math.floor(e.props.bodyColumns / names.length) : e.props.bodyColumns
    // 4: the border and the padding on each side.
    const textColumns = Math.max(1, boxColumns - 4 - LEAD)

    const taskLines = [...list]
      .sort((a, b) => RANK[a.status] - RANK[b.status])
      .flatMap(task =>
        wrap(`T${task.n} ${task.subject}`, textColumns).map(
          (text, index): Line => ({
            lead: index === 0 ? clock(task.at) : '',
            mark: index === 0 ? MARK[task.status] : ' ',
            color: MARK_COLOR[task.status],
            text,
            isDim: task.status === 'completed',
            isBold: task.status === 'in_progress',
          }),
        ),
      )
    // Newest first, so a question just asked shows without scrolling.
    const questionLines = [...open].reverse().flatMap(question =>
      wrap(`${question.id.toUpperCase()} ${question.text}`, textColumns).map(
        (text, index): Line => ({
          lead: index === 0 ? clock(question.at) : '',
          mark: ' ',
          color: 'text',
          text,
          isDim: false,
          isBold: false,
          ...(index === 0
            ? {
                press: {
                  key: `answered-${question.id}`,
                  label: '○',
                  run: () =>
                    update($, questions, value => ({
                      ...value,
                      open: value.open.filter(one => one.id !== question.id),
                    })),
                },
              }
            : {}),
        }),
      ),
    )
    const answerLines = [...answered].reverse().flatMap(one => [
      ...wrap(`A${one.n} ${one.question}`, textColumns).map(
        (text, index): Line => ({
          lead: index === 0 ? clock(one.at) : '',
          mark: ' ',
          color: 'text',
          text,
          isDim: false,
          isBold: true,
          // Beside the question, the mark that checks the entry off, as in the Open questions box.
          ...(index === 0
            ? {
                press: {
                  key: `done-${one.rowId}`,
                  label: '○',
                  run: () =>
                    update($, answers, value => ({
                      ...value,
                      list: value.list.filter(other => other.rowId !== one.rowId),
                    })),
                },
              }
            : {}),
        }),
      ),
      ...wrap(one.answer, textColumns).map(
        (text, index): Line => ({
          lead: '',
          mark: ' ',
          color: 'text',
          text,
          isDim: false,
          isBold: false,
          // Beside the answer, the mark that scrolls the conversation back to the full one.
          ...(index === 0
            ? {
                press: {
                  key: `jump-${one.rowId}`,
                  label: '↑',
                  run: async () => {
                    const moved = await $.ui.scroll({ to: { requestId: one.rowId }, block: 'center' })

                    if (moved.deny !== undefined) {
                      $.ui.toast(`Could not scroll back to that answer: ${moved.deny}`)
                    }
                  },
                },
              }
            : {}),
        }),
      ),
    ])

    // In the plan's order, not by state: the list is an agenda the person reads top to bottom.
    const pointLines = points.flatMap(one => [
      ...wrap(`D${one.n} ${one.topic}`, textColumns).map(
        (text, index): Line => ({
          lead: index === 0 ? clock(one.at) : '',
          mark: index === 0 ? POINT_MARK[one.state] : ' ',
          color: POINT_COLOR[one.state],
          text,
          isDim: false,
          isBold: one.state === 'discussing',
        }),
      ),
      ...(one.state === 'settled' ? wrap(`Decision: ${one.decision}`, textColumns) : []).map(
        (text): Line => ({ lead: '', mark: ' ', color: 'text', text, isDim: false, isBold: false }),
      ),
    ])

    const doneCount = list.filter(task => task.status === 'completed').length
    const settledCount = points.filter(one => one.state === 'settled').length
    const all: BoxSpec[] = [
      {
        name: 'tasks',
        title: 'Tasks',
        note:
          list.length === 0
            ? ''
            : `${list.length - doneCount} open${doneCount > 0 ? `, ${doneCount} done` : ''}`,
        empty: 'No tasks yet.',
        lines: taskLines,
      },
      {
        name: 'questions',
        title: 'Open questions',
        note: open.length === 0 ? '' : `${open.length} · press ○ when answered`,
        empty: 'No open questions.',
        lines: questionLines,
      },
      {
        name: 'answers',
        title: 'Answered',
        note: answered.length === 0 ? '' : `${answered.length} · ○ done · ↑ scroll back`,
        empty: 'No answered questions yet.',
        lines: answerLines,
      },
      {
        name: 'design',
        title: 'Design points',
        note:
          settledCount === points.length
            ? `all ${points.length} settled`
            : `${settledCount} settled, ${points.length - settledCount} to go`,
        empty: 'No design points.',
        lines: pointLines,
      },
    ]
    const boxes = all.filter(box => names.includes(box.name))

    // An empty box still shows one row saying so.
    const needs = boxes.map(box => Math.max(box.lines.length, 1))
    const total = e.props.scroll.bodyRows - boxes.length * CHROME
    // A dock too short to give every box a row draws them whole, and the pane scrolls as one.
    const isWhole = !isRow && total < boxes.length
    const rooms = isRow
      ? boxes.map(() => Math.max(1, Math.min(e.props.scroll.bodyRows, INLINE_ROWS) - CHROME))
      : isWhole
        ? needs
        : share(needs, total)
    const windows = boxes.map((box, index) =>
      windowOf(box.lines.length, rooms[index] ?? 1, isWhole ? 0 : at[box.name]),
    )

    let end = 0
    const max = { ...TOP }
    boxes.forEach((box, index) => {
      max[box.name] = windows[index]?.max ?? 0
    })
    drawn = {
      bodyRows: e.props.scroll.bodyRows,
      isRow,
      isWhole,
      names: boxes.map(box => box.name),
      ends: windows.map(shown => (end += isRow ? boxColumns : CHROME + shown.rows)),
      max,
    }

    return (
      <Box flexDirection={isRow ? 'row' : 'column'}>
        {boxes.map((box, index) => {
          const shown = windows[index] ?? windowOf(0, 1, 0)
          const step = Math.max(1, (rooms[index] ?? 1) - 2)
          const move = (by: number) => () =>
            update($, offsets, value => ({
              ...whole(value),
              [box.name]: clamp(Math.min(whole(value)[box.name], shown.max) + by, 0, shown.max),
            }))

          // Beside the title label, the note gives way first: squeezed, the label would wrap onto a
          // second row in a narrow box.
          return (
            <Box
              flexDirection="column"
              borderStyle="round"
              borderColor={BOX_COLOR[box.name]}
              paddingX={1}
              width={boxColumns}
            >
              <Box>
                <Box flexShrink={0}>
                  <Text bold color="inverseText" backgroundColor={BOX_COLOR[box.name]}>
                    {` ${box.title} `}
                  </Text>
                </Box>
                <Text dimColor wrap="truncate-end">
                  {' '}
                  {box.note}
                </Text>
              </Box>
              {shown.above > 0 && (
                <Button
                  plain
                  dimColor
                  key={`${box.name}-up`}
                  label={`▲ ${shown.above} more lines`}
                  onPress={move(-step)}
                />
              )}
              {box.lines.length === 0 && <Text dimColor>{box.empty}</Text>}
              {box.lines.slice(shown.first, shown.first + shown.shown).map(line => (
                <Box>
                  <Text dimColor>{line.lead.padEnd(6)}</Text>
                  {line.press === undefined ? (
                    <Text color={line.color}>{line.mark}</Text>
                  ) : (
                    <Button
                      plain
                      key={line.press.key}
                      label={line.press.label}
                      onPress={line.press.run}
                    />
                  )}
                  <Text dimColor={line.isDim} bold={line.isBold} wrap="truncate-end">
                    {' '}
                    {line.text}
                  </Text>
                </Box>
              ))}
              {shown.below > 0 && (
                <Button
                  plain
                  dimColor
                  key={`${box.name}-down`}
                  label={`▼ ${shown.below} more lines`}
                  onPress={move(step)}
                />
              )}
            </Box>
          )
        })}
      </Box>
    )
  })

  // The pull requests go across the window, one row each, in the band above the prompt: a stage
  // strip reads well on one long row, and the column beside the transcript keeps its rows.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { list: requests } = await read($, prs)

    if (e.props.hasSurvey || requests.length === 0) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {requests.map(one => {
          const place = STAGES.indexOf(one.stage)
          const title = one.number === undefined ? one.name : `${one.name} #${one.number}`
          const status = one.status === '' ? '' : ` · ${one.status}`
          // The stage it is at: yellow while it runs, green once live, red when something is wrong. Each
          // link takes the color of the stage it leads to, so the line fills in as the stages pass.
          const current = !one.isOk ? 'error' : one.stage === 'live' ? 'success' : 'warning'

          // Only the name and the status give way to a narrow window: squeezed, the marks and the
          // pipeline would wrap onto a second row.
          return (
            <Box>
              <Box flexShrink={0}>
                <Text dimColor>{clock(one.at)} </Text>
                <Text color={one.isOk ? 'success' : 'error'}>{one.isOk ? '✔' : '✖'}</Text>
              </Box>
              <Text wrap="truncate-end">{` P${one.n} ${title}`}</Text>
              <Box flexShrink={0}>
                <Text> · </Text>
                {STAGES.map((_, index) => (
                  <Text color={index < place ? 'success' : index === place ? current : 'inactive'}>
                    {`${index === 0 ? '' : '━'}${index < place ? '●' : index === place ? '◉' : '○'}`}
                  </Text>
                ))}
              </Box>
              <Text wrap="truncate-end">
                {' '}
                {`${STAGE_LABEL[one.stage]}${status}`}
              </Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}
