import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Offsets, PrStage, PullRequest, Questions, Task, TaskStatus } from '../types'

// Columns a row spends before its text: "16:21 ", the mark and a space.
const LEAD = 8
// Rows a box spends beside its list: the border's two and the title.
const CHROME = 3
// The most rows the board takes above the prompt, where a taller one crowds the transcript.
const INLINE_ROWS = 10
// How many answered questions the board keeps: the oldest leave first.
const KEPT_ANSWERS = 30
const KEPT_PRS = 10

const RANK: Record<TaskStatus, number> = { in_progress: 0, pending: 1, completed: 2 }
const MARK: Record<TaskStatus, string> = { in_progress: '◼', pending: '◻', completed: '✔' }
const MARK_COLOR: Record<TaskStatus, string> = {
  in_progress: 'claude',
  pending: 'inactive',
  completed: 'success',
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
The user keeps a board on screen with four boxes: Tasks, Open questions, Answered and Pull requests. Keeping them right is your job:
- mcp__sticky-board__tasks: for any work of more than a couple of steps, put your task list on the board before you start, and send it again each time a task starts or finishes, so the board always shows where you are. If you also have TaskCreate and TaskUpdate, tasks made with those reach the board by themselves: use one or the other, never both for the same task.
- mcp__sticky-board__questions: when your reply asks the user something you need answered, or leaves a decision to them, add each one, worded so that it makes sense on its own. When the user has answered one, or it no longer matters, resolve it by its id.
- mcp__sticky-board__answered: when the user asks you a question and you answer it, record it just before you write your answer: their question in a few words and your answer in one or two plain sentences, so they can still see it after your reply has scrolled away. A request to do work is not a question to record.
- mcp__sticky-board__prs: when you are taking a pull request through to release, report it each time it moves or its health changes: \`stage\` is pre_pr (running every test suite before opening it), open (the pull request is open), ci (CI is running on it), deploy (merged and deploying) or live; \`ok\` says whether everything is fine, and \`status\` says why in a few words. Keep the same \`name\` for it from start to finish.
Do not add rhetorical questions, and do not mention the board unless the user asks about it.`

const TOOLS = [
  'mcp__sticky-board__tasks',
  'mcp__sticky-board__questions',
  'mcp__sticky-board__answered',
  'mcp__sticky-board__prs',
]

// A subagent's own steps and asides are not the user's business: only the main conversation keeps the board.
const NOT_MAIN = 'Only the main conversation keeps the sticky board; nothing was changed.'
// The two sources of tasks keep their ids apart, so neither can touch the other's entries.
const OWN = 'board:'
const BUILT_IN = 'task:'

const tasks = atom({ plugin: 'sticky-board', key: 'tasks' } as const, [])
const questions = atom({ plugin: 'sticky-board', key: 'questions' } as const, {
  seq: 0,
  open: [],
})
const answers = atom({ plugin: 'sticky-board', key: 'answers' } as const, [])
const prs = atom({ plugin: 'sticky-board', key: 'prs' } as const, [])
const offsets = atom({ plugin: 'sticky-board', key: 'scroll' } as const, {
  tasks: 0,
  questions: 0,
  answers: 0,
  prs: 0,
})

// The boxes in the order they are drawn.
const ORDER: readonly (keyof Offsets)[] = ['tasks', 'questions', 'answers', 'prs']

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

    if (text !== '' && !open.some(one => one.text === text)) {
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
const closingQuestions = (answer: string): string[] =>
  (answer.trim().split(/\n\s*\n/).at(-1) ?? '')
    .split('\n')
    .flatMap(line =>
      line
        .replace(/^\s*(?:[-*+>]|\d+[.)])\s+/, '')
        // A full stop inside "e.g." and the like does not end a sentence.
        .split(/(?<=[.!?])(?<!\b(?:e\.g|i\.e|etc|vs)\.)\s+/),
    )
    .map(sentence => sentence.replace(/^[*_"'“”‘’\s]+|[*_"'“”‘’)\s]+$/g, ''))
    .filter(sentence => sentence.endsWith('?'))

export const register: Register = on => {
  // What the last drawing looked like, for the hook that scrolls it: a drawing may not write
  // $.state, and a scroll event carries neither the pane's width nor where its boxes sit.
  let drawn: { isRow: boolean; names: BoxName[]; ends: number[]; max: Offsets } = {
    isRow: false,
    names: [],
    ends: [],
    max: { tasks: 0, questions: 0, answers: 0, prs: 0 },
  }
  let seqAtTurnStart = -1

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sticky',
      description: 'Show the sticky board: tasks, open questions, answers and pull requests',
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
      await update($, tasks, () => [])
      await update($, questions, () => ({ seq: 0, open: [] }))
      await update($, answers, () => [])
      await update($, prs, () => [])
      await update($, offsets, () => ({ tasks: 0, questions: 0, answers: 0, prs: 0 }))
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
    await update($, tasks, (list): Task[] => [
      ...list.filter(task => task.id !== id),
      { id, subject, status: 'pending', at },
    ])

    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)

    if (ran.deny !== undefined || ran.isError === true || !ran.result.success) {
      return ran
    }

    const id = `${BUILT_IN}${e.taskId}`
    const at = await $.clock.now()
    await update($, tasks, list => {
      const rest = list.filter(task => task.id !== id)

      if (e.status === 'deleted') {
        return rest
      }

      // A task made before the board loaded is first heard of here, without its subject.
      const old = list.find(task => task.id === id)
      const status = e.status ?? old?.status ?? 'pending'
      const changed: Task = {
        id,
        subject: e.subject ?? old?.subject ?? `Task ${e.taskId}`,
        status,
        at: old !== undefined && old.status === status ? old.at : at,
      }

      return old === undefined
        ? [...rest, changed]
        : list.map(task => (task.id === id ? changed : task))
    })

    return ran
  })

  on('tool.call', { tool: 'mcp__sticky-board__tasks' }, async ($, e) => {
    if (e.agentId !== undefined) {
      return { result: NOT_MAIN }
    }

    const sent = sentTasks(e.tasks)
    const at = await $.clock.now()
    await update($, tasks, list => {
      // Each old entry lends its time to one new entry only, so two tasks of one name keep their own.
      const old = list.filter(task => task.id.startsWith(OWN))

      return [
        ...list.filter(task => !task.id.startsWith(OWN)),
        ...sent.map(({ subject, status }, index) => {
          // By subject, not by place: a task added in the middle leaves the times of the rest alone.
          const found = old.findIndex(task => task.subject === subject)
          const [same] = found === -1 ? [] : old.splice(found, 1)

          return { id: `${OWN}${index}`, subject, status, at: same?.status === status ? same.at : at }
        }),
      ]
    })

    return { result: `The board shows ${sent.length} ${sent.length === 1 ? 'task' : 'tasks'}.` }
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
      .filter(one => isTyped || Boolean(picked[one.question]))
      .map(one => one.question.trim())
    await update($, questions, value => ({
      ...value,
      open: value.open.filter(one => !answered.includes(one.text)),
    }))

    return ran
  })

  on('tool.call', { tool: 'mcp__sticky-board__questions' }, async ($, e) => {
    if (e.agentId !== undefined) {
      return { result: NOT_MAIN }
    }

    const add = strings(e.add)
    const resolve = strings(e.resolve)
    const at = await $.clock.now()
    const { open } = await update($, questions, value =>
      addTo({ ...value, open: value.open.filter(one => !resolve.includes(one.id)) }, add, at),
    )

    return {
      result:
        open.length === 0
          ? 'No open questions.'
          : open.map(one => `${one.id}: ${one.text}`).join('\n'),
    }
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
    await update($, answers, list =>
      [...list.filter(one => one.question !== question), { rowId, question, answer, at }].slice(
        -KEPT_ANSWERS,
      ),
    )

    return { result: 'Added to the Answered box.' }
  })

  on('tool.call', { tool: 'mcp__sticky-board__prs' }, async ($, e) => {
    if (e.agentId !== undefined) {
      return { result: NOT_MAIN }
    }

    const name = typeof e.name === 'string' ? e.name.trim() : ''

    if (name === '') {
      return { result: 'Nothing was changed: a pull request needs a name.' }
    }

    if (e.remove === true) {
      await update($, prs, list => list.filter(one => one.name !== name))

      return { result: `${name} is off the board.` }
    }

    const { stage, ok: isOk } = e

    if (!isStage(stage) || typeof isOk !== 'boolean') {
      return {
        result:
          'Nothing was changed: `stage` must be pre_pr, open, ci, deploy or live, and `ok` must be true or false.',
      }
    }

    const status = typeof e.status === 'string' ? e.status.trim() : ''
    const sent = typeof e.number === 'number' && Number.isInteger(e.number) && e.number > 0
    const at = await $.clock.now()
    await update($, prs, list => {
      const old = list.find(one => one.name === name)
      // A number, once known, stays with the pull request when a later report leaves it out.
      const number = sent ? Number(e.number) : old?.number
      const changed: PullRequest = {
        name,
        stage,
        isOk,
        status,
        at,
        ...(number === undefined ? {} : { number }),
      }

      return old === undefined
        ? [changed, ...list].slice(0, KEPT_PRS)
        : list.map(one => (one.name === name ? changed : one))
    })

    return {
      result: `${name}: stage ${STAGES.indexOf(stage) + 1} of ${STAGES.length} (${STAGE_LABEL[stage]}), ${isOk ? 'ok' : 'not ok'}.`,
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
    const { open } = await read($, questions)
    const isPerson =
      e.origin.kind === 'composer' ||
      e.origin.kind === 'bridge' ||
      e.origin.kind === 'sdk' ||
      e.origin.kind === 'slack-ping'

    if (!isPerson || open.length === 0) {
      return next(e)
    }

    // The model sees the open questions as the person replies, the moment it can tell which they answered.
    const note = [
      "Open questions on the user's sticky board:",
      ...open.map(one => `- ${one.id}: ${one.text}`),
      'If this message answers any of them, or one no longer matters, resolve it with mcp__sticky-board__questions.',
    ].join('\n')

    return next({ ...e, context: [...(e.context ?? []), note] })
  })

  on('turn.start', async ($, e, next) => {
    seqAtTurnStart = (await read($, questions)).seq

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const isMainAnswer = e.agentId === undefined && e.reason === 'answer'

    // The check behind the rule: a reply that ends on a question nobody recorded still reaches the board.
    if (isMainAnswer && (await read($, questions)).seq === seqAtTurnStart) {
      await addQuestions($, closingQuestions(e.answer))
    }

    return next(e)
  })

  on('ui.scroll', { requestId: 'sticky-board' }, async ($, e) => {
    const { pointer } = e
    const place = pointer === undefined ? -1 : drawn.isRow ? pointer.column : pointer.row
    // The wheel moves the box under it; the page keys, which point at nothing, move them all.
    const under = drawn.ends.findIndex(end => place < end)
    const aimed = pointer === undefined ? drawn.names : drawn.names.slice(under, under + 1)
    await update($, offsets, at => {
      const moved = { ...at }

      for (const name of under === -1 && pointer !== undefined ? drawn.names.slice(-1) : aimed) {
        moved[name] = clamp(at[name] + e.by, 0, drawn.max[name])
      }

      return moved
    })

    // Answered without next: the pane's own window stays put while a box moves its rows.
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: 'sticky-board' }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, tasks)
    const { open } = await read($, questions)
    const answered = await read($, answers)
    const requests = await read($, prs)
    const at = await read($, offsets)

    // Side by side in the short block above the prompt, stacked in the tall dock beside the transcript.
    const isRow = e.props.placement === 'inline'
    const counts: Offsets = {
      tasks: list.length,
      questions: open.length,
      answers: answered.length,
      prs: requests.length,
    }
    // Side by side every box costs width, so there only the ones with something to show are drawn.
    const filled = ORDER.filter(name => counts[name] > 0)
    const names = !isRow ? ORDER : filled.length > 0 ? filled : ORDER.slice(0, 1)
    const boxColumns = isRow ? Math.floor(e.props.bodyColumns / names.length) : e.props.bodyColumns
    // 4: the border and the padding on each side.
    const textColumns = Math.max(1, boxColumns - 4 - LEAD)

    const taskLines = [...list]
      .sort((a, b) => RANK[a.status] - RANK[b.status])
      .flatMap(task =>
        wrap(task.subject, textColumns).map(
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
      wrap(question.text, textColumns).map(
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
      ...wrap(one.question, textColumns).map(
        (text, index): Line => ({
          lead: index === 0 ? clock(one.at) : '',
          mark: ' ',
          color: 'text',
          text,
          isDim: false,
          isBold: true,
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
      ...wrap(one.answer, textColumns).map(
        (text): Line => ({ lead: '', mark: ' ', color: 'text', text, isDim: false, isBold: false }),
      ),
    ])

    const requestLines = requests.flatMap(one => {
      const place = STAGES.indexOf(one.stage) + 1
      const strip = `${'■'.repeat(place)}${'□'.repeat(STAGES.length - place)}`
      const title = one.number === undefined ? one.name : `${one.name} #${one.number}`

      return [
        ...wrap(title, textColumns).map(
          (text, index): Line => ({
            lead: index === 0 ? clock(one.at) : '',
            mark: index === 0 ? (one.isOk ? '✔' : '✖') : ' ',
            color: one.isOk ? 'success' : 'error',
            text,
            isDim: false,
            isBold: true,
          }),
        ),
        ...wrap(`${strip} ${place}/${STAGES.length} ${STAGE_LABEL[one.stage]}`, textColumns).map(
          (text): Line => ({ lead: '', mark: ' ', color: 'text', text, isDim: false, isBold: false }),
        ),
        ...(one.status === '' ? [] : wrap(one.status, textColumns)).map(
          (text): Line => ({ lead: '', mark: ' ', color: 'text', text, isDim: true, isBold: false }),
        ),
      ]
    })

    const doneCount = list.filter(task => task.status === 'completed').length
    const notOkCount = requests.filter(one => !one.isOk).length
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
        note: answered.length === 0 ? '' : `${answered.length} · press ↑ to scroll back`,
        empty: 'No answered questions yet.',
        lines: answerLines,
      },
      {
        name: 'prs',
        title: 'Pull requests',
        note:
          requests.length === 0
            ? ''
            : `${requests.length} · ${notOkCount === 0 ? 'all ok' : `${notOkCount} not ok`}`,
        empty: 'No pull requests in progress.',
        lines: requestLines,
      },
    ]
    const boxes = all.filter(box => names.includes(box.name))

    // An empty box still shows one row saying so.
    const needs = boxes.map(box => Math.max(box.lines.length, 1))
    const rooms = isRow
      ? boxes.map(() => Math.max(1, Math.min(e.props.scroll.bodyRows, INLINE_ROWS) - CHROME))
      : share(needs, e.props.scroll.bodyRows - boxes.length * CHROME)
    const windows = boxes.map((box, index) =>
      windowOf(box.lines.length, rooms[index] ?? 1, at[box.name]),
    )

    let end = 0
    const max: Offsets = { tasks: 0, questions: 0, answers: 0, prs: 0 }
    boxes.forEach((box, index) => {
      max[box.name] = windows[index]?.max ?? 0
    })
    drawn = {
      isRow,
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
              ...value,
              [box.name]: clamp(value[box.name] + by, 0, shown.max),
            }))

          return (
            <Box
              flexDirection="column"
              borderStyle="round"
              borderDimColor
              paddingX={1}
              width={boxColumns}
            >
              <Box>
                <Text bold>{box.title}</Text>
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
}
