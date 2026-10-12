import { expect, mock, test } from 'claude-code/testing'

const TASKS_TOOL = 'mcp__sticky-board__tasks'
const QUESTIONS_TOOL = 'mcp__sticky-board__questions'
const BASE_TIME = 1760300000000

const PANE = (
  placement: 'inline' | 'dock',
  bodyColumns: number,
  bodyRows: number,
): any => ({
  plugin: 'sticky-board',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'sticky-board',
  props: {
    title: 'Sticky board',
    isFocused: false,
    bodyColumns,
    placement,
    scroll: { offset: 0, bodyRows },
    view: {},
  },
})

const setup = (on: any, now = BASE_TIME) => {
  let taskSerial = 0
  const controls: any = {
    taskList: [],
    sections: [{ id: 'intro', text: 'Base prompt.', scope: 'shared' }],
    ask: async (_$: any, e: any) => ({
      result: { questions: e.questions, answers: {} },
    }),
  }

  on('tool.call', { tool: 'TaskCreate' }, async (_$: any, e: any) => ({
    result: {
      task: {
        id: `created-${++taskSerial}`,
        subject: e.subject,
      },
    },
  }))

  on('tool.call', { tool: 'TaskUpdate' }, async (_$: any, e: any) => ({
    result: {
      success: true,
      taskId: e.taskId,
      updatedFields: ['status'],
    },
  }))

  on('tool.call', { tool: 'TaskList' }, async () => ({
    result: { tasks: controls.taskList },
  }))

  on('tool.call', { tool: 'AskUserQuestion' }, async ($: any, e: any) =>
    controls.ask($, e),
  )

  on('turn.start', async (_$: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', async (_$: any, e: any) => ({ text: e.answer }))

  on('prompt.submit', async (_$: any, e: any) =>
    e.context === undefined
      ? { text: e.text }
      : { text: e.text, context: e.context },
  )

  on('prompt.compose', async () => ({ sections: controls.sections }))

  on('session.end', async (_$: any, e: any) => ({
    sessionId: e.sessionId,
  }))

  const clock = mock.clock(on, { now })
  return { controls, clock }
}

type ListedQuestion = { id: string; text: string }

const parseQuestions = (call: any): ListedQuestion[] => {
  const body = String(call.result)

  if (body === 'No open questions.') {
    return []
  }

  return body.split('\n').map(line => {
    const separator = line.indexOf(': ')

    if (separator < 1) {
      throw new Error(`Malformed question result line: ${line}`)
    }

    return {
      id: line.slice(0, separator),
      text: line.slice(separator + 2),
    }
  })
}

const listQuestions = async ($: any): Promise<ListedQuestion[]> =>
  parseQuestions(
    await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: [],
      resolve: [],
    }),
  )

const clearBoard = async ($: any): Promise<void> => {
  await $.tool.call({ tool: TASKS_TOOL, tasks: [] })
  await $.tool.call({ tool: 'TaskList' })

  const open = await listQuestions($)

  if (open.length > 0) {
    await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: [],
      resolve: open.map(question => question.id),
    })
  }
}

const textOf = (node: any): string => {
  if (typeof node === 'string') {
    return node
  }

  if (node == null || node === false) {
    return ''
  }

  const label =
    typeof node.props?.label === 'string' ? node.props.label : ''

  return label + (node.children ?? []).map(textOf).join('')
}

const borderedBoxes = (tree: any): any[] =>
  (tree?.children ?? []).filter(
    (child: any) =>
      child != null &&
      typeof child === 'object' &&
      child.type === 'Box' &&
      child.props?.borderStyle !== undefined,
  )

const boxRows = (tree: any, boxIndex: number): string[] =>
  (borderedBoxes(tree)[boxIndex]?.children ?? [])
    .filter((child: any) => child?.type === 'Box')
    .map(textOf)

const rowWith = (tree: any, boxIndex: number, text: string): string =>
  boxRows(tree, boxIndex).find(row => row.includes(text)) ?? ''

const timeAt = (milliseconds: number): string => {
  const date = new Date(milliseconds)
  return `${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`
}

const questionInput = (question: string): any => ({
  question,
  header: 'Choice',
  options: [
    { label: 'First', description: 'Use the first choice.' },
    { label: 'Second', description: 'Use the second choice.' },
  ],
  multiSelect: false,
})

const populateTallBoard = async ($: any): Promise<void> => {
  await $.tool.call({
    tool: TASKS_TOOL,
    tasks: Array.from({ length: 10 }, (_, index) => ({
      subject: `Task item ${String(index + 1).padStart(2, '0')}`,
      status: 'pending',
    })),
  })

  await $.tool.call({
    tool: QUESTIONS_TOOL,
    add: Array.from(
      { length: 10 },
      (_, index) => `Question item ${String(index + 1).padStart(2, '0')}?`,
    ),
    resolve: [],
  })
}

const scrollBoard = (
  $: any,
  by: number,
  bodyRows: number,
  pointer?: { column: number; row: number },
): Promise<any> =>
  $.ui.scroll({
    component: 'Pane',
    requestId: 'sticky-board',
    offset: 0,
    by,
    bodyRows,
    contentRows: 100,
    origin: { kind: 'person' },
    ...(pointer === undefined ? {} : { pointer }),
  })

test(
  'tasks tool filters malformed entries and an empty list replaces only its own tasks',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)

    await $.tool.call({
      tool: 'TaskCreate',
      subject: 'Built-in task',
      description: 'Keep this task.',
    })

    const changed = await $.tool.call({
      tool: TASKS_TOOL,
      tasks: [
        { subject: '  Valid board task  ', status: 'pending' },
        { status: 'pending' },
        { subject: 'Missing status' },
        { subject: 'Unknown status', status: 'blocked' },
        { subject: '   ', status: 'completed' },
        null,
        17,
        'not an object',
      ],
    })

    expect(changed).toEqual({ result: 'The board shows 1 task.' })

    const ui = await $.ui.mount(PANE('dock', 80, 30))
    let drawn = textOf(await ui.drawn())

    expect(drawn).toContain('Valid board task')
    expect(drawn).toContain('Built-in task')
    expect(drawn).not.toContain('Missing status')
    expect(drawn).not.toContain('Unknown status')
    expect(drawn).not.toContain('not an object')

    const emptied = await $.tool.call({ tool: TASKS_TOOL, tasks: [] })
    expect(emptied).toEqual({ result: 'The board shows 0 tasks.' })

    drawn = textOf(await ui.drawn())
    expect(drawn).toContain('Built-in task')
    expect(drawn).not.toContain('Valid board task')

    await ui.unmount()
  },
)

test(
  'TaskList replaces only built-in tasks and preserves their clock until status changes',
  async ($: any, on: any) => {
    const { controls, clock } = setup(on)
    await clearBoard($)

    await $.tool.call({
      tool: TASKS_TOOL,
      tasks: [{ subject: 'Board-owned task', status: 'pending' }],
    })
    await $.tool.call({
      tool: 'TaskCreate',
      subject: 'Obsolete built-in task',
      description: 'This should be replaced by TaskList.',
    })

    controls.taskList = [
      {
        id: 'listed-1',
        subject: 'Fresh built-in task',
        status: 'pending',
        blockedBy: [],
      },
    ]
    await $.tool.call({ tool: 'TaskList' })

    const ui = await $.ui.mount(PANE('dock', 80, 30))
    let tree = await ui.drawn()
    let all = textOf(tree)

    expect(all).toContain('Board-owned task')
    expect(all).toContain('Fresh built-in task')
    expect(all).not.toContain('Obsolete built-in task')
    expect(rowWith(tree, 0, 'Fresh built-in task')).toContain(
      timeAt(BASE_TIME),
    )

    await clock.advance(5 * 60_000)
    await $.tool.call({ tool: 'TaskList' })
    tree = await ui.drawn()
    expect(rowWith(tree, 0, 'Fresh built-in task')).toContain(
      timeAt(BASE_TIME),
    )

    await clock.advance(7 * 60_000)
    controls.taskList = [
      {
        id: 'listed-1',
        subject: 'Fresh built-in task',
        status: 'completed',
        blockedBy: [],
      },
    ]
    await $.tool.call({ tool: 'TaskList' })
    tree = await ui.drawn()
    expect(rowWith(tree, 0, 'Fresh built-in task')).toContain(
      timeAt(BASE_TIME + 12 * 60_000),
    )

    controls.taskList = []
    await $.tool.call({ tool: 'TaskList' })
    all = textOf(await ui.drawn())

    expect(all).toContain('Board-owned task')
    expect(all).not.toContain('Fresh built-in task')

    await ui.unmount()
  },
)

test(
  'tasks are drawn in progress, pending, completed order with local HH:MM clocks',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)

    await $.tool.call({
      tool: TASKS_TOOL,
      tasks: [
        { subject: 'Finished item', status: 'completed' },
        { subject: 'Waiting item', status: 'pending' },
        { subject: 'Working item', status: 'in_progress' },
      ],
    })

    const ui = await $.ui.mount(PANE('dock', 80, 30))
    const tree = await ui.drawn()
    const rows = boxRows(tree, 0).join('\n')

    expect(rows).toContain('Working item')
    expect(rows).toContain('Waiting item')
    expect(rows).toContain('Finished item')
    expect(rows.indexOf('Working item')).toBeLessThan(
      rows.indexOf('Waiting item'),
    )
    expect(rows.indexOf('Waiting item')).toBeLessThan(
      rows.indexOf('Finished item'),
    )

    for (const subject of [
      'Working item',
      'Waiting item',
      'Finished item',
    ]) {
      expect(rowWith(tree, 0, subject)).toContain(timeAt(BASE_TIME))
    }

    await ui.unmount()
  },
)

test(
  'tasks-tool clocks survive insertion and change only with task status',
  async ($: any, on: any) => {
    const { clock } = setup(on)
    await clearBoard($)

    await $.tool.call({
      tool: TASKS_TOOL,
      tasks: [{ subject: 'Alpha task', status: 'pending' }],
    })

    await clock.advance(5 * 60_000)
    await $.tool.call({
      tool: TASKS_TOOL,
      tasks: [
        { subject: 'Inserted task', status: 'pending' },
        { subject: 'Alpha task', status: 'pending' },
      ],
    })

    const ui = await $.ui.mount(PANE('dock', 80, 30))
    let tree = await ui.drawn()

    expect(rowWith(tree, 0, 'Alpha task')).toContain(timeAt(BASE_TIME))
    expect(rowWith(tree, 0, 'Inserted task')).toContain(
      timeAt(BASE_TIME + 5 * 60_000),
    )

    await clock.advance(7 * 60_000)
    await $.tool.call({
      tool: TASKS_TOOL,
      tasks: [
        { subject: 'Inserted task', status: 'pending' },
        { subject: 'Alpha task', status: 'completed' },
      ],
    })

    tree = await ui.drawn()
    expect(rowWith(tree, 0, 'Inserted task')).toContain(
      timeAt(BASE_TIME + 5 * 60_000),
    )
    expect(rowWith(tree, 0, 'Alpha task')).toContain(
      timeAt(BASE_TIME + 12 * 60_000),
    )
    expect(rowWith(tree, 0, 'Alpha task')).not.toContain(timeAt(BASE_TIME))

    await ui.unmount()
  },
)

test(
  'TaskCreate, TaskUpdate, and deleted status maintain the built-in task lifecycle',
  async ($: any, on: any) => {
    const { clock } = setup(on)
    await clearBoard($)

    const created = await $.tool.call({
      tool: 'TaskCreate',
      subject: 'Original subject',
      description: 'Exercise the lifecycle.',
    })
    const taskId = created.result.task.id

    await clock.advance(4 * 60_000)
    await $.tool.call({
      tool: 'TaskUpdate',
      taskId,
      subject: 'Renamed subject',
    })

    const ui = await $.ui.mount(PANE('dock', 80, 30))
    let tree = await ui.drawn()

    expect(rowWith(tree, 0, 'Renamed subject')).toContain(timeAt(BASE_TIME))
    expect(textOf(tree)).not.toContain('Original subject')

    await clock.advance(5 * 60_000)
    await $.tool.call({
      tool: 'TaskUpdate',
      taskId,
      status: 'in_progress',
    })

    tree = await ui.drawn()
    expect(rowWith(tree, 0, 'Renamed subject')).toContain(
      timeAt(BASE_TIME + 9 * 60_000),
    )
    expect(rowWith(tree, 0, 'Renamed subject')).not.toContain(
      timeAt(BASE_TIME),
    )

    await $.tool.call({
      tool: 'TaskUpdate',
      taskId,
      status: 'deleted',
    })

    const afterDelete = textOf(await ui.drawn())
    expect(afterDelete).not.toContain('Renamed subject')
    expect(afterDelete).toContain('No tasks yet.')

    await ui.unmount()
  },
)

test(
  'a whitespace-only built-in task still has one row matching the title count',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)

    await $.tool.call({
      tool: 'TaskCreate',
      subject: '   ',
      description: 'Keep a blank task visible.',
    })

    const ui = await $.ui.mount(PANE('dock', 80, 30))
    const tree = await ui.drawn()
    const taskBox = borderedBoxes(tree)[0]
    const itemRows = boxRows(tree, 0).slice(1)

    expect(textOf(taskBox)).toContain('Tasks 1 open')
    expect(textOf(taskBox)).not.toContain('No tasks yet.')
    expect(itemRows).toHaveLength(1)
    expect(itemRows[0]).toContain(timeAt(BASE_TIME))
    expect(itemRows[0]).toContain('◻')

    await ui.unmount()
  },
)

test(
  'questions tool ignores blanks and duplicates, tolerates unknown ids, and reports remaining questions',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)

    const firstCall = await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: ['', '   ', '  Choose a color?  ', 'Choose a color?'],
      resolve: ['unknown-id'],
    })
    const first = parseQuestions(firstCall)

    expect(first).toHaveLength(1)
    expect(first[0].id).toMatch(/^q\d+$/)
    expect(first[0].text).toBe('Choose a color?')
    expect(firstCall.result).toBe(`${first[0].id}: Choose a color?`)

    const second = parseQuestions(
      await $.tool.call({
        tool: QUESTIONS_TOOL,
        add: [' Choose a color? ', 'Choose a size?'],
        resolve: ['still-unknown'],
      }),
    )

    expect(second.map(question => question.text)).toStrictEqual([
      'Choose a color?',
      'Choose a size?',
    ])

    const afterResolve = parseQuestions(
      await $.tool.call({
        tool: QUESTIONS_TOOL,
        add: [],
        resolve: [first[0].id, 'another-unknown-id'],
      }),
    )

    expect(afterResolve).toHaveLength(1)
    expect(afterResolve[0].text).toBe('Choose a size?')

    const empty = await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: [],
      resolve: [afterResolve[0].id],
    })
    expect(empty).toEqual({ result: 'No open questions.' })
  },
)

test(
  'questions draw newest first and answered-id buttons remove only the selected question',
  async ($: any, on: any) => {
    const { clock } = setup(on)
    await clearBoard($)

    await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: ['Older question?'],
      resolve: [],
    })
    await clock.advance(60_000)
    await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: ['Newer question?'],
      resolve: [],
    })

    const listed = await listQuestions($)
    const newer = listed.find(question => question.text === 'Newer question?')
    const older = listed.find(question => question.text === 'Older question?')

    expect(newer).toBeDefined()
    expect(older).toBeDefined()

    const ui = await $.ui.mount(PANE('dock', 80, 30))
    let all = textOf(await ui.drawn())

    expect(all.indexOf('Newer question?')).toBeGreaterThanOrEqual(0)
    expect(all.indexOf('Older question?')).toBeGreaterThanOrEqual(0)
    expect(all.indexOf('Newer question?')).toBeLessThan(
      all.indexOf('Older question?'),
    )

    const answerKey = `answered-${newer!.id}`
    expect(await ui.find({ type: 'Button', key: answerKey })).toBeDefined()

    await ui.press({ key: answerKey })

    expect(await ui.find({ type: 'Button', key: answerKey })).toBeUndefined()
    expect((await listQuestions($)).map(question => question.text)).toStrictEqual([
      'Older question?',
    ])

    all = textOf(await ui.drawn())
    expect(all).toContain('Older question?')
    expect(all).not.toContain('Newer question?')

    await ui.unmount()
  },
)

test(
  'AskUserQuestion places a question on the board before the dialog and removes it when answered',
  async ($: any, on: any) => {
    const { controls } = setup(on)
    await clearBoard($)

    const question = 'Which database should be used?'
    let enterDialog = () => {}
    const dialogEntered = new Promise<void>(resolve => {
      enterDialog = resolve
    })
    let releaseDialog = () => {}
    const dialogReleased = new Promise<void>(resolve => {
      releaseDialog = resolve
    })

    controls.ask = async (_$: any, e: any) => {
      enterDialog()
      await dialogReleased

      return {
        result: {
          questions: e.questions,
          answers: { [question]: 'Postgres' },
        },
      }
    }

    const asking = $.tool.call({
      tool: 'AskUserQuestion',
      questions: [questionInput(question)],
    })

    await dialogEntered

    try {
      expect(
        (await listQuestions($)).map(open => open.text),
      ).toStrictEqual([question])
    } finally {
      releaseDialog()
      await asking
    }

    expect(await listQuestions($)).toStrictEqual([])
  },
)

test(
  'a multi-question AskUserQuestion removes only questions that received answers',
  async ($: any, on: any) => {
    const { controls } = setup(on)
    await clearBoard($)

    const answered = 'Which database?'
    const unanswered = 'Which port?'

    controls.ask = async (_$: any, e: any) => ({
      result: {
        questions: e.questions,
        answers: { [answered]: 'Postgres' },
      },
    })

    await $.tool.call({
      tool: 'AskUserQuestion',
      questions: [questionInput(answered), questionInput(unanswered)],
    })

    expect((await listQuestions($)).map(question => question.text)).toStrictEqual([
      unanswered,
    ])
  },
)

test(
  'denied and errored AskUserQuestion calls leave their questions open',
  async ($: any, on: any) => {
    const { controls } = setup(on)
    await clearBoard($)

    const deniedQuestion = 'Question from denied call?'
    const erroredQuestion = 'Question from errored call?'

    controls.ask = async (_$: any, e: any) => {
      if (e.questions[0].question === deniedQuestion) {
        return { deny: 'permission denied' }
      }

      return {
        isError: true,
        result: 'dialog failed',
        text: 'dialog failed',
      }
    }

    const denied = await $.tool.call({
      tool: 'AskUserQuestion',
      questions: [questionInput(deniedQuestion)],
    })
    const errored = await $.tool.call({
      tool: 'AskUserQuestion',
      questions: [questionInput(erroredQuestion)],
    })

    expect(denied).toEqual({ deny: 'permission denied' })
    expect(errored.isError).toBe(true)
    expect((await listQuestions($)).map(question => question.text)).toStrictEqual([
      deniedQuestion,
      erroredQuestion,
    ])
  },
)

test(
  'session.end clear and resume empty the board, reset both scroll offsets, and restart question ids',
  async ($: any, on: any) => {
    setup(on)

    await $.session.end({
      reason: 'clear',
      sessionId: 'session-baseline',
      resume: {},
    })
    await populateTallBoard($)

    const bodyRows = 8
    const ui = await $.ui.mount(PANE('inline', 80, bodyRows))

    for (const reason of ['clear', 'resume'] as const) {
      await scrollBoard($, -1000, bodyRows)
      await scrollBoard($, 2, bodyRows)

      expect(await ui.find({ key: 'tasks-up' })).toBeDefined()
      expect(await ui.find({ key: 'questions-up' })).toBeDefined()

      const sessionId = `session-${reason}`
      const ended = await $.session.end({
        reason,
        sessionId,
        resume: {},
      })

      expect(ended).toStrictEqual({ sessionId })

      const empty = textOf(await ui.drawn())
      expect(empty).toContain('No tasks yet.')
      expect(empty).toContain('No open questions.')
      expect(await listQuestions($)).toStrictEqual([])

      await populateTallBoard($)

      expect(
        (await listQuestions($)).map(question => question.id),
      ).toStrictEqual(
        Array.from({ length: 10 }, (_, index) => `q${index + 1}`),
      )
      expect(await ui.find({ key: 'tasks-up' })).toBeUndefined()
      expect(await ui.find({ key: 'questions-up' })).toBeUndefined()
    }

    await ui.unmount()
  },
)

test(
  'session.end with another reason preserves tasks, questions, ids, and both scroll offsets',
  async ($: any, on: any) => {
    setup(on)

    await $.session.end({
      reason: 'clear',
      sessionId: 'session-baseline',
      resume: {},
    })
    await populateTallBoard($)

    const bodyRows = 8
    const ui = await $.ui.mount(PANE('inline', 80, bodyRows))
    await scrollBoard($, -1000, bodyRows)
    await scrollBoard($, 2, bodyRows)

    const questionsBefore = await listQuestions($)
    const drawingBefore = textOf(await ui.drawn())
    const taskUpBefore = (await ui.find({ key: 'tasks-up' }))?.props.label
    const questionUpBefore = (await ui.find({ key: 'questions-up' }))?.props
      .label

    expect(taskUpBefore).toBeDefined()
    expect(questionUpBefore).toBeDefined()

    const sessionId = 'session-prompt-input-exit'
    const ended = await $.session.end({
      reason: 'prompt_input_exit',
      sessionId,
      resume: {},
    })

    expect(ended).toStrictEqual({ sessionId })
    expect(await listQuestions($)).toStrictEqual(questionsBefore)
    expect(textOf(await ui.drawn())).toBe(drawingBefore)
    expect((await ui.find({ key: 'tasks-up' }))?.props.label).toBe(
      taskUpBefore,
    )
    expect((await ui.find({ key: 'questions-up' }))?.props.label).toBe(
      questionUpBefore,
    )

    const afterAdd = parseQuestions(
      await $.tool.call({
        tool: QUESTIONS_TOOL,
        add: ['Question after exit?'],
        resolve: [],
      }),
    )
    expect(afterAdd.at(-1)).toStrictEqual({
      id: 'q11',
      text: 'Question after exit?',
    })

    await ui.unmount()
  },
)

test(
  'subagent calls to both sticky-board tools report no change and preserve the main board',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)

    await $.tool.call({
      tool: TASKS_TOOL,
      tasks: [{ subject: 'Main task', status: 'in_progress' }],
    })
    const mainQuestions = parseQuestions(
      await $.tool.call({
        tool: QUESTIONS_TOOL,
        add: ['Main question?'],
        resolve: [],
      }),
    )

    const taskResult = await $.tool.call({
      tool: TASKS_TOOL,
      tasks: [{ subject: 'Subagent task', status: 'completed' }],
      agentId: 'agent-1',
    } as any)
    const questionResult = await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: ['Subagent question?'],
      resolve: [mainQuestions[0].id],
      agentId: 'agent-1',
    } as any)

    const unchanged =
      'Only the main conversation keeps the sticky board; nothing was changed.'
    expect(taskResult).toEqual({ result: unchanged })
    expect(questionResult).toEqual({ result: unchanged })

    const ui = await $.ui.mount(PANE('dock', 80, 30))
    const all = textOf(await ui.drawn())

    expect(all).toContain('Main task')
    expect(all).not.toContain('Subagent task')
    expect((await listQuestions($)).map(question => question.text)).toStrictEqual([
      'Main question?',
    ])

    await ui.unmount()
  },
)

test(
  'answer fallback extracts only question sentences from the last paragraph, strips list and quote markers, and draws newest first',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)

    const answer = [
      'Should this question in an earlier paragraph be ignored?',
      '',
      'This middle paragraph has no board content.',
      '',
      '- **First fallback?**',
      '2. _Second fallback?_',
      '> **Quoted fallback?**',
      'Third fallback? This sentence is not a question.',
    ].join('\n')

    await $.turn.start({ text: 'Finish the work.', turnId: 'turn-fallback' })
    await $.turn.complete({
      answer,
      durationMs: 10,
      isAborted: false,
      turnId: 'turn-fallback',
      reason: 'answer',
    })

    expect((await listQuestions($)).map(question => question.text)).toStrictEqual([
      'First fallback?',
      'Second fallback?',
      'Quoted fallback?',
      'Third fallback?',
    ])

    const ui = await $.ui.mount(PANE('dock', 100, 30))
    const all = textOf(await ui.drawn())

    expect(all).not.toContain(
      'Should this question in an earlier paragraph be ignored?',
    )
    expect(all.indexOf('Third fallback?')).toBeLessThan(
      all.indexOf('Quoted fallback?'),
    )
    expect(all.indexOf('Quoted fallback?')).toBeLessThan(
      all.indexOf('Second fallback?'),
    )
    expect(all.indexOf('Second fallback?')).toBeLessThan(
      all.indexOf('First fallback?'),
    )

    await ui.unmount()
  },
)

test(
  'answer fallback adds nothing when a question was explicitly added during the turn',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)

    await $.turn.start({ text: 'Do the work.', turnId: 'turn-explicit' })
    await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: ['Explicitly tracked question?'],
      resolve: [],
    })
    await $.turn.complete({
      answer: 'The work is done.\n\nFallback should not appear?',
      durationMs: 10,
      isAborted: false,
      turnId: 'turn-explicit',
      reason: 'answer',
    })

    expect((await listQuestions($)).map(question => question.text)).toStrictEqual([
      'Explicitly tracked question?',
    ])
  },
)

test(
  'fallback ignores subagent answers and main turns ending for a reason other than answer',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)

    await $.turn.start({ text: 'Run the main turn.', turnId: 'turn-main' })

    await $.turn.complete({
      answer: 'Subagent question must not leak?',
      durationMs: 5,
      isAborted: false,
      turnId: 'turn-subagent',
      reason: 'answer',
      agentId: 'agent-2',
    })

    await $.turn.complete({
      answer: 'Error-ending question must not appear?',
      durationMs: 10,
      isAborted: false,
      turnId: 'turn-main',
      reason: 'error',
    })

    expect(await listQuestions($)).toStrictEqual([])
  },
)

test(
  'prompt.submit appends one question context entry for composer, bridge, and sdk origins',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)

    const questions = parseQuestions(
      await $.tool.call({
        tool: QUESTIONS_TOOL,
        add: ['First open question?', 'Second open question?'],
        resolve: [],
      }),
    )

    for (const kind of ['composer', 'bridge', 'sdk'] as const) {
      const result = await $.prompt.submit({
        text: `Reply through ${kind}`,
        context: ['existing context'],
        wait: false,
        origin: { kind },
      })

      expect(result.text).toBe(`Reply through ${kind}`)
      expect(result.context).toHaveLength(2)
      expect(result.context?.[0]).toBe('existing context')
      expect(typeof result.context?.[1]).toBe('string')

      for (const question of questions) {
        expect(result.context?.[1]).toContain(
          `${question.id}: ${question.text}`,
        )
      }
    }
  },
)

test(
  'prompt.submit passes every non-person origin through without adding context',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)

    await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: ['Still open?'],
      resolve: [],
    })

    const origins: any[] = [
      { kind: 'task-notification' },
      { kind: 'scheduled-trigger' },
      { kind: 'peer' },
      { kind: 'peer-send-message' },
      { kind: 'projects-relay' },
      { kind: 'channel', server: 'messages' },
      { kind: 'coordinator' },
      { kind: 'observer' },
      { kind: 'observer-activity' },
      { kind: 'auto-continuation' },
      { kind: 'unclassified' },
      { kind: 'slack-ping' },
      { kind: 'plugin', name: 'another-plugin' },
    ]

    for (const origin of origins) {
      const result = await $.prompt.submit({
        text: `Message from ${origin.kind}`,
        context: ['keep this'],
        wait: false,
        origin,
      })

      expect(result).toStrictEqual({
        text: `Message from ${origin.kind}`,
        context: ['keep this'],
      })
    }
  },
)

test(
  'prompt.submit passes a person-origin prompt through when no questions are open',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)

    const result = await $.prompt.submit({
      text: 'Nothing to resolve.',
      context: ['existing context'],
      wait: false,
      origin: { kind: 'composer' },
    })

    expect(result).toStrictEqual({
      text: 'Nothing to resolve.',
      context: ['existing context'],
    })
  },
)

test(
  'prompt.compose keeps existing sections and appends the sticky-board session section last',
  async ($: any, on: any) => {
    const { controls } = setup(on)
    const base = [
      { id: 'intro', text: 'Base prompt.', scope: 'shared' },
      {
        id: 'existing:session',
        text: 'Existing session text.',
        scope: 'session',
      },
    ]
    controls.sections = base

    const result = await $.prompt.compose({
      model: 'test-model',
      promptModel: 'test-model',
      surfaces: ['terminal'],
      tools: ['Bash', QUESTIONS_TOOL],
      outputStyle: null,
      traits: [],
    })

    expect(result.sections).toHaveLength(3)
    expect(result.sections.slice(0, 2)).toStrictEqual(base)
    expect(result.sections[2].id).toBe('sticky-board:questions')
    expect(result.sections[2].scope).toBe('session')
    expect(result.sections[2].text).toContain(QUESTIONS_TOOL)
  },
)

test(
  'prompt.compose adds nothing without a surface or without the questions tool',
  async ($: any, on: any) => {
    const { controls } = setup(on)
    const base = [{ id: 'intro', text: 'Base prompt.', scope: 'shared' }]
    controls.sections = base

    const withoutSurface = await $.prompt.compose({
      model: 'test-model',
      promptModel: 'test-model',
      surfaces: [],
      tools: [QUESTIONS_TOOL],
      outputStyle: null,
      traits: [],
    })
    const withoutTool = await $.prompt.compose({
      model: 'test-model',
      promptModel: 'test-model',
      surfaces: ['terminal'],
      tools: ['Bash'],
      outputStyle: null,
      traits: [],
    })

    expect(withoutSurface).toStrictEqual({ sections: base })
    expect(withoutTool).toStrictEqual({ sections: base })
  },
)

test(
  'empty inline and dock drawings contain two correctly sized bordered boxes',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)

    for (const expected of [
      {
        placement: 'inline' as const,
        direction: 'row',
        columns: 81,
        widths: [40, 40],
      },
      {
        placement: 'dock' as const,
        direction: 'column',
        columns: 81,
        widths: [81, 81],
      },
    ]) {
      const ui = await $.ui.mount(
        PANE(expected.placement, expected.columns, 30),
      )
      const tree: any = await ui.drawn()
      const boxes = borderedBoxes(tree)

      expect(tree.type).toBe('Box')
      expect(tree.props.flexDirection).toBe(expected.direction)
      expect(boxes).toHaveLength(2)
      expect(boxes.map(box => box.props.width)).toStrictEqual(expected.widths)
      expect(textOf(boxes[0])).toContain('No tasks yet.')
      expect(textOf(boxes[1])).toContain('No open questions.')

      await ui.unmount()
    }
  },
)

test(
  'long task and question text wrap onto following rows without truncation',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)

    const longTask = 'abcdefghijklmnopqrstuvwx'
    const longQuestion = 'ABCDEFGHIJKLMNOPQRSTUVW?'

    await $.tool.call({
      tool: TASKS_TOOL,
      tasks: [{ subject: longTask, status: 'pending' }],
    })
    await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: [longQuestion],
      resolve: [],
    })

    const ui = await $.ui.mount(PANE('dock', 24, 18))
    const tree = await ui.drawn()
    const taskRows = boxRows(tree, 0)
    const questionRows = boxRows(tree, 1)

    const taskFirst = taskRows.findIndex(row => row.includes('abcdefghijkl'))
    const taskSecond = taskRows.findIndex(row => row.includes('mnopqrstuvwx'))
    const questionFirst = questionRows.findIndex(row =>
      row.includes('ABCDEFGHIJKL'),
    )
    const questionSecond = questionRows.findIndex(row =>
      row.includes('MNOPQRSTUVW?'),
    )

    expect(taskFirst).toBeGreaterThanOrEqual(0)
    expect(taskSecond).toBe(taskFirst + 1)
    expect(questionFirst).toBeGreaterThanOrEqual(0)
    expect(questionSecond).toBe(questionFirst + 1)
    expect(await ui.find({ type: 'Text', text: longTask })).toBeUndefined()
    expect(
      await ui.find({ type: 'Text', text: longQuestion }),
    ).toBeUndefined()

    await ui.unmount()
  },
)

test(
  'task and question paging buttons scroll only their own boxes and expose up buttons',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)
    await populateTallBoard($)

    const bodyRows = 8
    const ui = await $.ui.mount(PANE('inline', 80, bodyRows))
    await scrollBoard($, -1000, bodyRows)

    expect(await ui.find({ key: 'tasks-down' })).toBeDefined()
    expect(await ui.find({ key: 'questions-down' })).toBeDefined()
    expect(await ui.find({ key: 'tasks-up' })).toBeUndefined()
    expect(await ui.find({ key: 'questions-up' })).toBeUndefined()

    const questionDownBefore = await ui.find({ key: 'questions-down' })
    await ui.press({ key: 'tasks-down' })

    expect(await ui.find({ key: 'tasks-up' })).toBeDefined()
    expect(await ui.find({ key: 'questions-up' })).toBeUndefined()
    expect((await ui.find({ key: 'questions-down' }))?.props.label).toBe(
      questionDownBefore?.props.label,
    )

    const taskUpBefore = await ui.find({ key: 'tasks-up' })
    await ui.press({ key: 'questions-down' })

    expect(await ui.find({ key: 'questions-up' })).toBeDefined()
    expect((await ui.find({ key: 'tasks-up' }))?.props.label).toBe(
      taskUpBefore?.props.label,
    )

    await ui.unmount()
  },
)

test(
  'ui.scroll resolves empty and moves only the box under the pointer in inline and dock layouts',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)
    await populateTallBoard($)

    const layouts = [
      {
        placement: 'inline' as const,
        columns: 80,
        rows: 8,
        taskPointer: { column: 2, row: 2 },
        questionPointer: { column: 60, row: 2 },
      },
      {
        placement: 'dock' as const,
        columns: 80,
        rows: 14,
        taskPointer: { column: 2, row: 2 },
        questionPointer: { column: 2, row: 10 },
      },
    ]

    for (const layout of layouts) {
      const ui = await $.ui.mount(
        PANE(layout.placement, layout.columns, layout.rows),
      )
      await scrollBoard($, -1000, layout.rows)

      expect(await ui.find({ key: 'tasks-up' })).toBeUndefined()
      expect(await ui.find({ key: 'questions-up' })).toBeUndefined()

      const taskScroll = await scrollBoard(
        $,
        2,
        layout.rows,
        layout.taskPointer,
      )

      expect(taskScroll).toStrictEqual({})
      expect(await ui.find({ key: 'tasks-up' })).toBeDefined()
      expect(await ui.find({ key: 'questions-up' })).toBeUndefined()

      const taskUpAfterTaskScroll = await ui.find({ key: 'tasks-up' })
      const questionScroll = await scrollBoard(
        $,
        2,
        layout.rows,
        layout.questionPointer,
      )

      expect(questionScroll).toStrictEqual({})
      expect(await ui.find({ key: 'questions-up' })).toBeDefined()
      expect((await ui.find({ key: 'tasks-up' }))?.props.label).toBe(
        taskUpAfterTaskScroll?.props.label,
      )

      await ui.unmount()
    }
  },
)
