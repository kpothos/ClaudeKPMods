import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  Answers,
  DesignPoint,
  DesignPoints,
  DesignState,
  Note,
  Notes,
  Offsets,
  PrStage,
  PullRequest,
  PullRequests,
  Question,
  Questions,
  RuleState,
  SavedBoard,
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
// How many of the person's notes the board keeps: the oldest leave first.
const KEPT_NOTES = 30
// How many conversations' boards $.store keeps for a resume: the oldest leave first.
const KEPT_BOARDS = 20
// NOTE: the store holds 4 MiB in all, so a board larger than this is not kept for a resume rather
// than crowding out the others. A board of the usual size is a few thousand characters.
const MAX_SAVED = 150_000
// The $.store key of a kept board, before the conversation's id.
const SAVED = 'board:'

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

// Theme keys rather than fixed colors, so each box keeps its blue, orange, green, purple or yellow in a light or dark theme.
const BOX_COLOR: Record<keyof Offsets, string> = {
  tasks: 'ide',
  questions: 'claude',
  answers: 'success',
  design: 'merged',
  notes: 'warning',
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

// The same rule, for a conversation whose system prompt was built before the board was on screen.
const LATE_RULE = `The user's sticky board is now on screen, but this conversation's instructions were set before it was. These instructions about the board hold from now on:\n\n${RULE}`

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
const notes = atom({ plugin: 'sticky-board', key: 'notes' } as const, { seq: 0, list: [] } as Notes)
const TOP: Offsets = { tasks: 0, questions: 0, answers: 0, design: 0, notes: 0 }
const offsets = atom({ plugin: 'sticky-board', key: 'scroll' } as const, TOP)
// A session keeps its values across an update of the mod: offsets kept by a version with fewer
// boxes lack the newer ones, which start at the top.
const whole = (value: Offsets): Offsets => ({ ...TOP, ...value })
// The engine keeps sending the system prompt built for a conversation's first message, until it
// compacts. The desktop app attaches only after that message, so there the rule is left out of
// it, and the person's next message carries it instead.
const rule = atom({ plugin: 'sticky-board', key: 'rule' } as const, 'unknown' as RuleState)
// Which conversation the board on screen belongs to: the engine empties $.state when a /clear or
// /resume switches conversations, which leaves this empty too.
const owner = atom({ plugin: 'sticky-board', key: 'owner' } as const, '')

// The boxes in the order they are drawn.
const ORDER: readonly (keyof Offsets)[] = ['tasks', 'questions', 'answers', 'design', 'notes']

type BoxName = keyof Offsets

type Press = { key: string; label: string; run: () => unknown }

type Line = {
  lead: string
  mark: string
  color: string
  text: string
  isDim: boolean
  isBold: boolean
  // A mark the person can press, drawn in the mark's place.
  press?: Press
  // In a box whose entries carry two marks, the second, drawn after the first; `null` leaves its
  // column empty, so the text of every row in the box starts in the same column.
  jump?: Press | null
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

const addTo = (
  value: Questions,
  texts: readonly string[],
  at: number,
  rowId?: string,
): Questions => {
  let open = [...value.open]
  let seq = value.seq

  for (const raw of texts) {
    const text = raw.trim()
    // A refused action worded the same is not this question: it leaves the board on its own terms.
    const isAsked = (one: Question) => one.blocked === undefined && one.text === text

    if (text === '') {
      continue
    }

    if (!open.some(isAsked)) {
      seq += 1
      open.push({ id: `q${seq}`, text, at, ...(rowId === undefined ? {} : { rowId }) })
    } else if (rowId !== undefined) {
      // NOTE: asked again, a question keeps its label and its ↑ goes to where it was asked last:
      // a short one such as "OK with that?" is about whatever came just before it.
      open = open.map(one => (isAsked(one) ? { ...one, rowId } : one))
    }
  }

  return { seq, open }
}

const addQuestions = async ($: EngineInterface, texts: readonly string[], rowId?: string) => {
  const at = await $.clock.now()

  return update($, questions, value => addTo(value, texts, at, rowId))
}

// Brings an entry's transcript row back into view; `what` names the entry in the toast when the
// row is not drawn.
const scrollBack = async ($: EngineInterface, rowId: string, what: string) => {
  const moved = await $.ui.scroll({ to: { requestId: rowId }, block: 'center' })

  if (moved.deny !== undefined) {
    $.ui.toast(`Could not scroll back to that ${what}: ${moved.deny}`)
  }
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

const isLabel = (value: unknown): value is number => isCount(value) && value >= 1

// One kept box: its counter and every entry in the form the board draws, or nothing at all, since
// a board drawn from a half-good copy could fail to draw. A counter behind an entry's label would
// give that label out again.
const keptBox = (
  value: unknown,
  listKey: string,
  isEntry: (one: Record<string, unknown>) => boolean,
  labelOf: (one: Record<string, unknown>) => number = one => Number(one.n),
) => {
  if (!isRecord(value) || !isCount(value.seq)) {
    return undefined
  }

  const { seq } = value
  const list = value[listKey]

  return Array.isArray(list) &&
    list.every(one => isRecord(one) && isEntry(one) && labelOf(one) <= seq)
    ? { seq, list: list as unknown[] }
    : undefined
}

// A board $.store kept, as this version wrote it, or nothing when any part of it is not.
const keptBoard = (value: unknown): SavedBoard | undefined => {
  if (!isRecord(value) || value.v !== 1 || !isTime(value.at)) {
    return undefined
  }

  const kept = {
    tasks: keptBox(
      value.tasks,
      'list',
      one =>
        typeof one.id === 'string' &&
        isLabel(one.n) &&
        typeof one.subject === 'string' &&
        isStatus(one.status) &&
        isTime(one.at),
    ),
    // Refused actions are never kept: they belong to the process that was refused.
    questions: keptBox(
      value.questions,
      'open',
      one =>
        typeof one.id === 'string' &&
        /^q[1-9]\d*$/.test(one.id) &&
        typeof one.text === 'string' &&
        isTime(one.at) &&
        one.blocked === undefined &&
        (one.rowId === undefined || typeof one.rowId === 'string'),
      one => Number(String(one.id).slice(1)),
    ),
    answers: keptBox(
      value.answers,
      'list',
      one =>
        isLabel(one.n) &&
        typeof one.rowId === 'string' &&
        typeof one.question === 'string' &&
        typeof one.answer === 'string' &&
        isTime(one.at),
    ),
    prs: keptBox(
      value.prs,
      'list',
      one =>
        isLabel(one.n) &&
        typeof one.name === 'string' &&
        (one.number === undefined || isLabel(one.number)) &&
        isStage(one.stage) &&
        typeof one.isOk === 'boolean' &&
        typeof one.status === 'string' &&
        isTime(one.at),
    ),
    design: keptBox(
      value.design,
      'list',
      one =>
        isLabel(one.n) &&
        typeof one.topic === 'string' &&
        typeof one.state === 'string' &&
        Object.hasOwn(POINT_MARK, one.state) &&
        typeof one.decision === 'string' &&
        isTime(one.at),
    ),
    notes: keptBox(
      value.notes,
      'list',
      one => isLabel(one.n) && typeof one.text === 'string' && isTime(one.at),
    ),
  }
  const { tasks: t, questions: q, answers: a, prs: p, design: d, notes: n } = kept

  if (!t || !q || !a || !p || !d || !n) {
    return undefined
  }

  return {
    v: 1,
    at: value.at,
    tasks: { seq: t.seq, list: t.list as Task[] },
    questions: { seq: q.seq, open: q.list as Question[] },
    answers: { seq: a.seq, list: a.list as Answers['list'] },
    prs: { seq: p.seq, list: p.list as PullRequest[] },
    design: { seq: d.seq, list: d.list as DesignPoint[] },
    notes: { seq: n.seq, list: n.list as Note[] },
  }
}

// The board as it stands, for a resume; nothing when it is empty and no label was ever given, so
// there is nothing a resume would need.
const snapshot = async ($: EngineInterface): Promise<SavedBoard | undefined> => {
  const [t, q, a, p, d, n] = await Promise.all([
    read($, tasks),
    read($, questions),
    read($, answers),
    read($, prs),
    read($, design),
    read($, notes),
  ])
  const open = q.open.filter(one => one.blocked === undefined)
  // The counters too: a board emptied by hand still must not give a label out again.
  const isUsed =
    [t.seq, q.seq, a.seq, p.seq, d.seq, n.seq].some(seq => seq > 0) ||
    [t.list, open, a.list, p.list, d.list, n.list].some(list => list.length > 0)

  return isUsed
    ? {
        v: 1,
        at: await $.clock.now(),
        tasks: t,
        questions: { seq: q.seq, open },
        answers: a,
        prs: p,
        design: d,
        notes: n,
      }
    : undefined
}

// Kept under the conversation's id, for `claude --resume` and /resume to bring back. Only the
// board that belongs to the ending conversation is written: one not yet brought back is empty,
// and would wipe the kept copy.
const saveBoard = async ($: EngineInterface, id: string) => {
  const [who, board] = await Promise.all([read($, owner), snapshot($)])

  if (who !== id) {
    return
  }

  const key = `${SAVED}${id}`

  if (board === undefined || JSON.stringify(board).length > MAX_SAVED) {
    await $.store.delete(key)

    return
  }

  // Written before the oldest are let go: a write that fails then costs no other board, and two
  // sessions ending at once each see the other's board when they count.
  await $.store.set(key, board)

  // The other kept boards, newest first, read from the boards themselves: a list of them, written
  // by two sessions ending at once, would each leave out the other's board, which would then never
  // be let go. Each key is written on its own, so neither session's board is lost (seen with two
  // real sessions). One that could not be brought back leaves first. This board stays whatever
  // its time, so the newest of the others make up the rest.
  const others = await Promise.all(
    (await $.store.keys())
      .filter(one => one.startsWith(SAVED) && one !== key)
      .map(async one => ({ key: one, at: keptBoard(await $.store.get(one))?.at ?? 0 })),
  )
  others.sort((a, b) => b.at - a.at)
  await Promise.all(others.slice(KEPT_BOARDS - 1).map(one => $.store.delete(one.key)))
}

// Brings back the board kept for this conversation, once per conversation: a reload runs
// session.start again, and must not bring back what the person has since taken off.
const takeOver = async ($: EngineInterface) => {
  const id = await $.session.id()

  if ((await read($, owner)) === id) {
    return
  }

  const [t, q, a, p, d, n] = await Promise.all([
    read($, tasks),
    read($, questions),
    read($, answers),
    read($, prs),
    read($, design),
    read($, notes),
  ])
  const isEmpty = [t.list, q.open, a.list, p.list, d.list, n.list].every(list => list.length === 0)
  // NOTE: a kept board that cannot be read is passed over, and the board starts empty.
  const board = isEmpty ? keptBoard(await $.store.get(`${SAVED}${id}`).catch(() => undefined)) : undefined

  await Promise.all([
    update($, owner, () => id),
    ...(board === undefined
      ? []
      : [
          update($, tasks, () => board.tasks),
          update($, questions, () => board.questions),
          update($, answers, () => board.answers),
          update($, prs, () => board.prs),
          update($, design, () => board.design),
          update($, notes, () => board.notes),
        ]),
  ])
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`

// The whole board on one line, for the desktop app's small widget, where clicks may not reach.
const glance = (board: {
  tasks: readonly Task[]
  open: number
  answered: number
  points: readonly DesignPoint[]
  notes: number
  prs: number
}): string => {
  const openTasks = board.tasks.filter(task => task.status !== 'completed').length
  const discussing = board.points.find(one => one.state === 'discussing')
  const toGo = board.points.filter(one => one.state !== 'settled').length
  const parts = [
    openTasks > 0
      ? `${plural(openTasks, 'task', 'tasks')} open`
      : board.tasks.length > 0
        ? `all ${plural(board.tasks.length, 'task', 'tasks')} done`
        : '',
    board.open > 0 ? plural(board.open, 'open question', 'open questions') : '',
    discussing !== undefined
      ? `D${discussing.n} being discussed`
      : toGo > 0
        ? `${plural(toGo, 'design point', 'design points')} to go`
        : board.points.length > 0
          ? `all ${plural(board.points.length, 'design point', 'design points')} settled`
          : '',
    board.notes > 0 ? plural(board.notes, 'note', 'notes') : '',
    board.answered > 0 ? `${board.answered} answered` : '',
    board.prs > 0 ? plural(board.prs, 'pull request', 'pull requests') : '',
  ].filter(part => part !== '')

  return parts.length === 0 ? 'Nothing on the board yet.' : parts.join(' · ')
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
  // This turn's last row of reply text, where a question the board picks out of the reply was asked.
  let replyRow = ''
  // Calls whose questions point at the call until its result comes in: the transcript draws a
  // dismissed dialog under its result's row, not under the call's id, so the ↑ moves there.
  const awaitingResult = new Set<string>()

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sticky',
      description:
        'Show the sticky board (tasks, open questions, answers, design points, notes), or pin a note of your own to it with /sticky note <text>',
      argumentHint: '[note <text>]',
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
    // A conversation started with `claude --resume` or `--continue` gets its board back here. A
    // kept board that cannot be brought back must not stop the board from opening.
    await takeOver($).catch(() => undefined)
    void $.ui.open({ id: 'sticky-board', title: 'Sticky board' }).then(opened => {
      if (!opened.isPlaced) {
        $.ui.toast('The sticky board is hidden in a narrow window. Type /sticky to show it.')
      }
    })

    return next(e)
  })

  on('command.run', { command: 'sticky' }, async ($, e) => {
    // A note pinned right after a /resume typed in the session must land on that conversation's
    // board, brought back first, or the board would claim the conversation without it.
    await takeOver($).catch(() => undefined)

    // NOTE: `args` is documented as "" when left out, but a plugin's `$.command.run` without it
    // reached this hook as undefined in the test kit (2.1.325).
    const asked = /^note(?:\s+([\s\S]*))?$/i.exec((e.args ?? '').trim())

    if (asked === null) {
      await $.ui.open({ id: 'sticky-board', title: 'Sticky board' })

      return { text: 'Sticky board opened.' }
    }

    const text = (asked[1] ?? '').replace(/\s+/g, ' ').trim()

    // A toast, not the command's output: the output goes to Claude, and the note is the person's own.
    if (text === '') {
      $.ui.toast('Type the note after the command: /sticky note <text>')

      return {}
    }

    const at = await $.clock.now()
    const { seq } = await update($, notes, (value): Notes => ({
      seq: value.seq + 1,
      list: [...value.list, { n: value.seq + 1, text, at }].slice(-KEPT_NOTES),
    }))
    await $.ui.open({ id: 'sticky-board', title: 'Sticky board' })
    $.ui.toast(`Pinned N${seq} to the board.`)

    return {}
  })

  on('session.end', async ($, e, next) => {
    // NOTE: a board that could not be kept is lost for a resume, and nothing more: the session
    // still ends, and the board below still empties.
    await saveBoard($, e.sessionId).catch(() => undefined)

    // The process goes on with another conversation, which the old one's board says nothing about.
    if (e.reason === 'clear' || e.reason === 'resume') {
      await Promise.all([
        update($, tasks, () => ({ seq: 0, list: [] })),
        update($, questions, () => ({ seq: 0, open: [] })),
        update($, answers, () => ({ seq: 0, list: [] })),
        update($, prs, () => ({ seq: 0, list: [] })),
        update($, design, () => ({ seq: 0, list: [] })),
        update($, notes, () => ({ seq: 0, list: [] })),
        update($, offsets, () => TOP),
        update($, rule, () => 'unknown' as RuleState),
        update($, owner, () => ''),
      ])
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
    awaitingResult.add(e.tool_use_id)
    await addQuestions(
      $,
      e.questions.map(one => one.question),
      e.tool_use_id,
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
        // The call's own row sits beside the reply that asks: a press on the question scrolls back to it.
        e.tool_use_id,
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

      // NOTE: never seen live, as a refusal cannot be made on purpose: like a dismissed dialog's,
      // the refused call's row may be drawn under its result's id, so the ↑ moves there if that
      // result comes in after this; a press that finds no row says so in a toast.
      awaitingResult.add(e.tool_use_id)

      return {
        seq,
        open: [...value.open, { id: `q${seq}`, text, at, blocked, rowId: e.tool_use_id }],
      }
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
    const hasTools = TOOLS.every(tool => e.tools.includes(tool))
    const isSent = e.surfaces.length > 0 && hasTools

    // Only the first prompt is sent: the ones built after it change nothing the model reads. A
    // screen arriving later makes up for a missing screen, not for missing tools.
    if ((await read($, rule)) === 'unknown') {
      const decided: RuleState = !isSent && hasTools ? 'owed' : 'settled'
      await update($, rule, value => (value === 'unknown' ? decided : value))
    }

    if (!isSent) {
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
    // A /resume typed in the session switches conversations with no event of its own: the board
    // of the resumed one comes back with the first message there, the person's or any other
    // (a task's notification, a scheduled prompt), before that message's turn can change it.
    await takeOver($).catch(() => undefined)

    const isPerson =
      e.origin.kind === 'composer' ||
      e.origin.kind === 'bridge' ||
      e.origin.kind === 'sdk' ||
      e.origin.kind === 'slack-ping'

    if (!isPerson) {
      return next(e)
    }

    const lines: string[] = []

    let isTelling = false

    // A run that never draws, like `claude -p`, is never told: the board stays out of its way.
    if ((await read($, rule)) === 'owed' && (await $.session.surfaces()).length > 0) {
      await update($, rule, value => {
        // Set by the run that is written, as in classic.PermissionDenied: one message carries it.
        isTelling = value === 'owed'

        return isTelling ? 'told' : value
      })

      if (isTelling) {
        lines.push(LATE_RULE)
      }
    }

    // A refused action is the person's to approve in /permissions, not the model's to resolve.
    const open = (await read($, questions)).open.filter(one => one.blocked === undefined)

    // The model sees the open questions as the person replies, the moment it can tell which they answered.
    if (open.length > 0) {
      lines.push(
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
      lines.push(
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
    const named = new Set((e.text.match(/\b[TAPDN]\d+\b/gi) ?? []).map(label => label.toUpperCase()))

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
        // The only way a note reaches Claude: the person named it.
        ...(await read($, notes)).list
          .filter(one => named.has(`N${one.n}`))
          .map(one => `- N${one.n}: the user's own note "${one.text}"`),
      ]

      if (found.length > 0) {
        lines.push(
          ["Entries on the user's sticky board that this message names:", ...found].join('\n'),
        )
      }
    }

    const entered =
      lines.length === 0 ? await next(e) : await next({ ...e, context: [...(e.context ?? []), ...lines] })

    // A prompt that did not enter took the rule with it: the next one carries it instead.
    if (isTelling && entered.drop !== undefined) {
      await update($, rule, value => (value === 'told' ? 'owed' : value))
    }

    return entered
  })

  on('turn.start', async ($, e, next) => {
    // A subagent's turn starts inside the main one: counting from there would forget what the
    // main turn had already added.
    if (e.agentId !== undefined) {
      return next(e)
    }

    seqAtTurnStart = (await read($, questions)).seq
    blockedAdds = 0
    replyRow = ''

    return next(e)
  })

  // Each block of a reply is a row of its own, under the id the transcript draws it by: a press
  // scrolls there. Every row of the conversation passes through here, so only the result row of a
  // call the board waits on is waited for.
  on('session.append', async ($, e, next) => {
    if (
      e.agentId === undefined &&
      e.door === 'response' &&
      e.message.content.some(
        block => block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '',
      )
    ) {
      replyRow = e.uuid
    }

    if (awaitingResult.size > 0 && e.door === 'tool-result') {
      for (const block of e.message.content) {
        const callId = block.type === 'tool_result' ? block.tool_use_id : undefined

        if (typeof callId === 'string' && awaitingResult.delete(callId)) {
          const isThere = (one: Question) => one.rowId === callId

          // Read first: an answered dialog's questions have left already, and a write for nothing
          // draws the board again.
          if ((await read($, questions)).open.some(isThere)) {
            await update($, questions, value => ({
              ...value,
              open: value.open.map(one => (isThere(one) ? { ...one, rowId: e.uuid } : one)),
            }))
          }
        }
      }
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const isMainAnswer = e.agentId === undefined && e.reason === 'answer'

    // The check behind the rule: a reply that ends on a question nobody recorded still reaches the board.
    if (isMainAnswer && (await read($, questions)).seq - blockedAdds === seqAtTurnStart) {
      await addQuestions($, closingQuestions(e.answer), replyRow === '' ? undefined : replyRow)
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
    const { list: pinned } = await read($, notes)

    // The desktop app's small widget: one line read at a glance, no marks to press. It leaves
    // `drawn` alone, which is the full pane's for the scroll hook.
    if (e.props.placement === 'widget') {
      const { list: requests } = await read($, prs)

      return (
        <Box>
          <Text>
            {glance({
              tasks: list,
              open: open.length,
              answered: answered.length,
              points,
              notes: pinned.length,
              prs: requests.length,
            })}
          </Text>
        </Box>
      )
    }

    const at = whole(await read($, offsets))

    // Side by side in the short block above the prompt, stacked in the tall dock beside the transcript.
    const isRow = e.props.placement === 'inline'
    const counts: Offsets = {
      tasks: list.length,
      questions: open.length,
      answers: answered.length,
      design: points.length,
      notes: pinned.length,
    }
    // Side by side every box costs width, so there only the ones with something to show are drawn.
    const filled = ORDER.filter(name => counts[name] > 0)
    // Design points come and go with a plan, and notes with the person: with none, their box is not
    // drawn in the dock either.
    const docked = ORDER.filter(
      name => (name !== 'design' && name !== 'notes') || counts[name] > 0,
    )
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
    // Newest first, so a question just asked shows without scrolling. 2: the ↑ and the space after it.
    const questionLines = [...open].reverse().flatMap(question =>
      wrap(`${question.id.toUpperCase()} ${question.text}`, Math.max(1, textColumns - 2)).map(
        (text, index): Line => {
          const { rowId } = question

          return {
            lead: index === 0 ? clock(question.at) : '',
            mark: ' ',
            color: 'text',
            text,
            isDim: false,
            isBold: false,
            jump:
              index === 0 && rowId !== undefined
                ? {
                    key: `asked-${question.id}`,
                    label: '↑',
                    run: () => scrollBack($, rowId, 'question'),
                  }
                : null,
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
          }
        },
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
                  run: () => scrollBack($, one.rowId, 'answer'),
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

    // Newest first, as with the questions.
    const noteLines = [...pinned].reverse().flatMap(one =>
      wrap(`N${one.n} ${one.text}`, textColumns).map(
        (text, index): Line => ({
          lead: index === 0 ? clock(one.at) : '',
          mark: ' ',
          color: 'text',
          text,
          isDim: false,
          isBold: false,
          ...(index === 0
            ? {
                press: {
                  key: `note-${one.n}`,
                  label: '○',
                  run: () =>
                    update($, notes, value => ({
                      ...value,
                      list: value.list.filter(other => other.n !== one.n),
                    })),
                },
              }
            : {}),
        }),
      ),
    )

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
        note: open.length === 0 ? '' : `${open.length} · ○ answered · ↑ scroll back`,
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
      {
        name: 'notes',
        title: 'Notes',
        note: pinned.length === 0 ? '' : `${pinned.length} · press ○ to remove`,
        empty: 'No notes.',
        lines: noteLines,
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
                  {line.jump !== undefined && <Text>{' '}</Text>}
                  {line.jump === null && <Text>{' '}</Text>}
                  {line.jump !== undefined && line.jump !== null && (
                    <Button
                      plain
                      key={line.jump.key}
                      label={line.jump.label}
                      onPress={line.jump.run}
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
