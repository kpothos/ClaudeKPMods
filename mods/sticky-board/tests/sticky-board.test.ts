import { expect, mock, test } from 'claude-code/testing'

const TASKS_TOOL = 'mcp__sticky-board__tasks'
const QUESTIONS_TOOL = 'mcp__sticky-board__questions'
const ANSWERED_TOOL = 'mcp__sticky-board__answered'
const PRS_TOOL = 'mcp__sticky-board__prs'
const BOARD_TOOLS = [
  TASKS_TOOL,
  QUESTIONS_TOOL,
  ANSWERED_TOOL,
  PRS_TOOL,
] as const
const BOX_NAMES = ['tasks', 'questions', 'answers', 'prs'] as const
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
    nextTaskId: undefined,
    sections: [{ id: 'intro', text: 'Base prompt.', scope: 'shared' }],
    ask: async (_$: any, e: any) => ({
      result: { questions: e.questions, answers: {} },
    }),
  }

  on('tool.call', { tool: 'TaskCreate' }, async (_$: any, e: any) => {
    const taskId =
      controls.nextTaskId === undefined
        ? `created-${++taskSerial}`
        : controls.nextTaskId
    controls.nextTaskId = undefined

    return {
      result: {
        task: {
          id: taskId,
          subject: e.subject,
        },
      },
    }
  })

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
  await $.session.end({
    reason: 'clear',
    sessionId: 'test-clear',
    resume: {},
  })
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

const boxRowNodes = (tree: any, boxIndex: number): any[] =>
  (borderedBoxes(tree)[boxIndex]?.children ?? []).filter(
    (child: any) => child?.type === 'Box',
  )

const boxRows = (tree: any, boxIndex: number): string[] =>
  boxRowNodes(tree, boxIndex).map(textOf)

const rowNodeWith = (tree: any, boxIndex: number, text: string): any =>
  boxRowNodes(tree, boxIndex).find(row => textOf(row).includes(text))

const rowWith = (tree: any, boxIndex: number, text: string): string =>
  textOf(rowNodeWith(tree, boxIndex, text))

const rowButton = (
  tree: any,
  boxIndex: number,
  text: string,
  keyPrefix: string,
): any =>
  (rowNodeWith(tree, boxIndex, text)?.children ?? []).find(
    (child: any) =>
      child?.type === 'Button' &&
      typeof child.props?.key === 'string' &&
      child.props.key.startsWith(keyPrefix),
  )

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

const numberQuestionInput = (question: string): any => ({
  question,
  header: 'Count',
  kind: 'number',
  min: 0,
  max: 10,
  step: 1,
  defaultValue: 0,
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

  for (let index = 1; index <= 6; index += 1) {
    await $.tool.call({
      tool: ANSWERED_TOOL,
      question: `Answered question ${String(index).padStart(2, '0')}?`,
      answer: `Answer item ${String(index).padStart(2, '0')}.`,
    })

    await $.tool.call({
      tool: PRS_TOOL,
      name: `Pull request ${String(index).padStart(2, '0')}`,
      stage: 'ci',
      ok: true,
      status: `Still running ${String(index).padStart(2, '0')}.`,
    })
  }
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
  'tasks tool filters malformed entries and replaces only its own tasks even when a built-in id resembles a board id',
  async ($: any, on: any) => {
    const { controls } = setup(on)
    await clearBoard($)

    controls.nextTaskId = 'board:0'
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

    expect(changed).toEqual({
      result:
        'The board shows 1 task.\nT2 [pending] Valid board task',
    })

    const ui = await $.ui.mount(PANE('dock', 80, 30))
    let tree = await ui.drawn()
    let drawn = textOf(tree)

    expect(rowWith(tree, 0, 'Built-in task')).toContain('T1 Built-in task')
    expect(rowWith(tree, 0, 'Valid board task')).toContain(
      'T2 Valid board task',
    )
    expect(drawn).not.toContain('Missing status')
    expect(drawn).not.toContain('Unknown status')
    expect(drawn).not.toContain('not an object')

    const emptied = await $.tool.call({ tool: TASKS_TOOL, tasks: [] })
    expect(emptied).toEqual({ result: 'The board shows 0 tasks.' })

    tree = await ui.drawn()
    drawn = textOf(tree)
    expect(rowWith(tree, 0, 'Built-in task')).toContain('T1 Built-in task')
    expect(drawn).not.toContain('Valid board task')

    const returned = await $.tool.call({
      tool: TASKS_TOOL,
      tasks: [{ subject: 'Valid board task', status: 'pending' }],
    })
    expect(returned).toStrictEqual({
      result:
        'The board shows 1 task.\nT3 [pending] Valid board task',
    })

    tree = await ui.drawn()
    expect(rowWith(tree, 0, 'Built-in task')).toContain('T1 Built-in task')
    expect(rowWith(tree, 0, 'Valid board task')).toContain(
      'T3 Valid board task',
    )

    await ui.unmount()
  },
)

test(
  'TaskList calls leave both task sources and their clocks unchanged',
  async ($: any, on: any) => {
    const { controls, clock } = setup(on)
    await clearBoard($)

    await $.tool.call({
      tool: TASKS_TOOL,
      tasks: [{ subject: 'Board-owned task', status: 'pending' }],
    })
    await $.tool.call({
      tool: 'TaskCreate',
      subject: 'Built-in task',
      description: 'TaskList must not replace this.',
    })

    const ui = await $.ui.mount(PANE('dock', 80, 30))
    const before = boxRows(await ui.drawn(), 0)
    await clock.advance(9 * 60_000)

    controls.taskList = [
      {
        id: 'stale-task',
        subject: 'Stale listed task',
        status: 'completed',
        blockedBy: [],
      },
    ]

    const listed = await $.tool.call({ tool: 'TaskList' })

    expect(listed).toStrictEqual({
      result: { tasks: controls.taskList },
    })

    const tree = await ui.drawn()
    expect(boxRows(tree, 0)).toStrictEqual(before)

    const all = textOf(tree)
    expect(rowWith(tree, 0, 'Board-owned task')).toContain(
      'T1 Board-owned task',
    )
    expect(rowWith(tree, 0, 'Built-in task')).toContain('T2 Built-in task')
    expect(all).not.toContain('Stale listed task')
    expect(rowWith(tree, 0, 'Board-owned task')).toContain(timeAt(BASE_TIME))
    expect(rowWith(tree, 0, 'Built-in task')).toContain(timeAt(BASE_TIME))

    await ui.unmount()
  },
)

test(
  'tasks are drawn in progress, pending, completed order with local HH:MM clocks',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)

    const result = await $.tool.call({
      tool: TASKS_TOOL,
      tasks: [
        { subject: 'Finished item', status: 'completed' },
        { subject: 'Waiting item', status: 'pending' },
        { subject: 'Working item', status: 'in_progress' },
      ],
    })

    expect(result).toStrictEqual({
      result: [
        'The board shows 3 tasks.',
        'T1 [completed] Finished item',
        'T2 [pending] Waiting item',
        'T3 [in_progress] Working item',
      ].join('\n'),
    })

    const ui = await $.ui.mount(PANE('dock', 80, 30))
    const tree = await ui.drawn()
    const rows = boxRows(tree, 0).join('\n')

    expect(rows).toContain('T3 Working item')
    expect(rows).toContain('T2 Waiting item')
    expect(rows).toContain('T1 Finished item')
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
  'tasks-tool labels and clocks survive insertion and status changes but not removal',
  async ($: any, on: any) => {
    const { clock } = setup(on)
    await clearBoard($)

    await $.tool.call({
      tool: TASKS_TOOL,
      tasks: [{ subject: 'Alpha task', status: 'pending' }],
    })

    await clock.advance(5 * 60_000)
    const inserted = await $.tool.call({
      tool: TASKS_TOOL,
      tasks: [
        { subject: 'Inserted task', status: 'pending' },
        { subject: 'Alpha task', status: 'pending' },
      ],
    })

    expect(inserted).toStrictEqual({
      result: [
        'The board shows 2 tasks.',
        'T2 [pending] Inserted task',
        'T1 [pending] Alpha task',
      ].join('\n'),
    })

    const ui = await $.ui.mount(PANE('dock', 80, 30))
    let tree = await ui.drawn()

    expect(rowWith(tree, 0, 'Alpha task')).toContain('T1 Alpha task')
    expect(rowWith(tree, 0, 'Alpha task')).toContain(timeAt(BASE_TIME))
    expect(rowWith(tree, 0, 'Inserted task')).toContain('T2 Inserted task')
    expect(rowWith(tree, 0, 'Inserted task')).toContain(
      timeAt(BASE_TIME + 5 * 60_000),
    )

    await clock.advance(7 * 60_000)
    const changed = await $.tool.call({
      tool: TASKS_TOOL,
      tasks: [
        { subject: 'Inserted task', status: 'pending' },
        { subject: 'Alpha task', status: 'completed' },
      ],
    })

    expect(changed).toStrictEqual({
      result: [
        'The board shows 2 tasks.',
        'T2 [pending] Inserted task',
        'T1 [completed] Alpha task',
      ].join('\n'),
    })

    tree = await ui.drawn()
    expect(rowWith(tree, 0, 'Inserted task')).toContain(
      timeAt(BASE_TIME + 5 * 60_000),
    )
    expect(rowWith(tree, 0, 'Alpha task')).toContain('T1 Alpha task')
    expect(rowWith(tree, 0, 'Alpha task')).toContain(
      timeAt(BASE_TIME + 12 * 60_000),
    )
    expect(rowWith(tree, 0, 'Alpha task')).not.toContain(timeAt(BASE_TIME))

    await $.tool.call({
      tool: TASKS_TOOL,
      tasks: [{ subject: 'Inserted task', status: 'pending' }],
    })
    const readded = await $.tool.call({
      tool: TASKS_TOOL,
      tasks: [
        { subject: 'Alpha task', status: 'pending' },
        { subject: 'Inserted task', status: 'pending' },
      ],
    })

    expect(readded).toStrictEqual({
      result: [
        'The board shows 2 tasks.',
        'T3 [pending] Alpha task',
        'T2 [pending] Inserted task',
      ].join('\n'),
    })

    tree = await ui.drawn()
    expect(rowWith(tree, 0, 'Alpha task')).toContain('T3 Alpha task')
    expect(rowWith(tree, 0, 'Inserted task')).toContain('T2 Inserted task')

    await ui.unmount()
  },
)

test(
  'duplicate task subjects each retain their own label and clock',
  async ($: any, on: any) => {
    const { clock } = setup(on)
    await clearBoard($)

    await $.tool.call({
      tool: TASKS_TOOL,
      tasks: [{ subject: 'Repeated task', status: 'pending' }],
    })

    await clock.advance(5 * 60_000)
    const duplicated = await $.tool.call({
      tool: TASKS_TOOL,
      tasks: [
        { subject: 'Repeated task', status: 'pending' },
        { subject: 'Repeated task', status: 'pending' },
      ],
    })

    expect(duplicated).toStrictEqual({
      result: [
        'The board shows 2 tasks.',
        'T1 [pending] Repeated task',
        'T2 [pending] Repeated task',
      ].join('\n'),
    })

    const ui = await $.ui.mount(PANE('dock', 80, 30))
    let tree = await ui.drawn()
    let duplicates = boxRows(tree, 0).filter(row =>
      row.includes('Repeated task'),
    )

    expect(duplicates).toHaveLength(2)
    expect(duplicates[0]).toContain('T1 Repeated task')
    expect(duplicates[0]).toContain(timeAt(BASE_TIME))
    expect(duplicates[1]).toContain('T2 Repeated task')
    expect(duplicates[1]).toContain(timeAt(BASE_TIME + 5 * 60_000))

    await clock.advance(4 * 60_000)
    const unchanged = await $.tool.call({
      tool: TASKS_TOOL,
      tasks: [
        { subject: 'Repeated task', status: 'pending' },
        { subject: 'Repeated task', status: 'pending' },
      ],
    })

    expect(unchanged).toStrictEqual(duplicated)

    tree = await ui.drawn()
    duplicates = boxRows(tree, 0).filter(row =>
      row.includes('Repeated task'),
    )
    expect(duplicates).toHaveLength(2)
    expect(duplicates[0]).toContain('T1 Repeated task')
    expect(duplicates[0]).toContain(timeAt(BASE_TIME))
    expect(duplicates[1]).toContain('T2 Repeated task')
    expect(duplicates[1]).toContain(timeAt(BASE_TIME + 5 * 60_000))

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

    expect(rowWith(tree, 0, 'Renamed subject')).toContain(
      'T1 Renamed subject',
    )
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
      'T1 Renamed subject',
    )
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

    await $.tool.call({
      tool: 'TaskUpdate',
      taskId: 'discovered-late',
      subject: 'Discovered task',
      status: 'pending',
    })

    tree = await ui.drawn()
    expect(rowWith(tree, 0, 'Discovered task')).toContain(
      'T2 Discovered task',
    )

    const boardTask = await $.tool.call({
      tool: TASKS_TOOL,
      tasks: [{ subject: 'Board task after built-ins', status: 'pending' }],
    })
    expect(boardTask).toStrictEqual({
      result:
        'The board shows 1 task.\nT3 [pending] Board task after built-ins',
    })

    tree = await ui.drawn()
    expect(rowWith(tree, 0, 'Discovered task')).toContain(
      'T2 Discovered task',
    )
    expect(rowWith(tree, 0, 'Board task after built-ins')).toContain(
      'T3 Board task after built-ins',
    )

    await ui.unmount()
  },
)

test(
  'a whitespace-only built-in task still has one labeled row matching the title count',
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
    expect(itemRows[0]).toContain('T1')

    await ui.unmount()
  },
)

test(
  'questions tool ignores malformed values, accepts either id case, and never reuses a resolved label',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)

    const firstCall = await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: ['', '   ', '  Choose a color?  ', 'Choose a color?'],
      resolve: ['unknown-id'],
    })
    const first = parseQuestions(firstCall)

    expect(first).toStrictEqual([
      { id: 'Q1', text: 'Choose a color?' },
    ])
    expect(first[0].id).toMatch(/^Q\d+$/)
    expect(firstCall.result).toBe('Q1: Choose a color?')

    const second = parseQuestions(
      await $.tool.call({
        tool: QUESTIONS_TOOL,
        add: [' Choose a color? ', 'Choose a size?'],
        resolve: ['still-unknown'],
      }),
    )

    expect(second).toStrictEqual([
      { id: 'Q1', text: 'Choose a color?' },
      { id: 'Q2', text: 'Choose a size?' },
    ])

    const malformed = parseQuestions(
      await $.tool.call({
        tool: QUESTIONS_TOOL,
        add: { question: 'Not an array?' },
        resolve: 17,
      } as any),
    )
    expect(malformed).toStrictEqual(second)

    const afterLowerCaseResolve = parseQuestions(
      await $.tool.call({
        tool: QUESTIONS_TOOL,
        add: [],
        resolve: [first[0].id.toLowerCase(), 'another-unknown-id'],
      }),
    )

    expect(afterLowerCaseResolve).toStrictEqual([
      { id: 'Q2', text: 'Choose a size?' },
    ])

    const empty = await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: [],
      resolve: [afterLowerCaseResolve[0].id],
    })
    expect(empty).toEqual({ result: 'No open questions.' })

    const readded = parseQuestions(
      await $.tool.call({
        tool: QUESTIONS_TOOL,
        add: ['Choose a color?'],
        resolve: [],
      }),
    )
    expect(readded).toStrictEqual([
      { id: 'Q3', text: 'Choose a color?' },
    ])
  },
)

test(
  'questions draw newest first and lower-case answered-id buttons remove only the selected question',
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

    expect(newer).toStrictEqual({ id: 'Q2', text: 'Newer question?' })
    expect(older).toStrictEqual({ id: 'Q1', text: 'Older question?' })

    const ui = await $.ui.mount(PANE('dock', 80, 30))
    let tree = await ui.drawn()
    let all = textOf(tree)

    expect(rowWith(tree, 1, 'Newer question?')).toContain(
      'Q2 Newer question?',
    )
    expect(rowWith(tree, 1, 'Older question?')).toContain(
      'Q1 Older question?',
    )
    expect(all.indexOf('Newer question?')).toBeLessThan(
      all.indexOf('Older question?'),
    )

    const answerKey = `answered-${newer!.id.toLowerCase()}`
    expect(answerKey).toBe('answered-q2')
    expect(await ui.find({ type: 'Button', key: answerKey })).toBeDefined()

    await ui.press({ key: answerKey })

    expect(await ui.find({ type: 'Button', key: answerKey })).toBeUndefined()
    expect(await listQuestions($)).toStrictEqual([
      { id: 'Q1', text: 'Older question?' },
    ])

    tree = await ui.drawn()
    all = textOf(tree)
    expect(all).toContain('Q1 Older question?')
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
      expect(await listQuestions($)).toStrictEqual([
        { id: 'Q1', text: question },
      ])
    } finally {
      releaseDialog()
      await asking
    }

    expect(await listQuestions($)).toStrictEqual([])
  },
)

test(
  'a multi-question AskUserQuestion removes exactly the questions with non-blank answers',
  async ($: any, on: any) => {
    const { controls } = setup(on)
    await clearBoard($)

    const answered = 'Which database?'
    const presentWithEmptyAnswer = 'Which schema?'
    const presentWithWhitespaceAnswer = 'Which region?'
    const answeredWithZero = 'How many replicas?'
    const unanswered = 'Which port?'

    controls.ask = async (_$: any, e: any) => ({
      result: {
        questions: e.questions,
        answers: {
          [answered]: 'Postgres',
          [presentWithEmptyAnswer]: '',
          [presentWithWhitespaceAnswer]: '   ',
          [answeredWithZero]: 0,
        },
        response: 'Use SQLite for every question.',
      },
    })

    await $.tool.call({
      tool: 'AskUserQuestion',
      questions: [
        questionInput(answered),
        questionInput(presentWithEmptyAnswer),
        questionInput(presentWithWhitespaceAnswer),
        numberQuestionInput(answeredWithZero),
        questionInput(unanswered),
      ],
    })

    expect((await listQuestions($)).map(question => question.text)).toStrictEqual([
      presentWithEmptyAnswer,
      presentWithWhitespaceAnswer,
      unanswered,
    ])
  },
)

test(
  'a one-question AskUserQuestion free-text response counts as an answer',
  async ($: any, on: any) => {
    const { controls } = setup(on)
    await clearBoard($)

    const question = 'Which database should be used?'
    controls.ask = async (_$: any, e: any) => ({
      result: {
        questions: e.questions,
        answers: {},
        response: 'Use SQLite',
      },
    })

    const result = await $.tool.call({
      tool: 'AskUserQuestion',
      questions: [questionInput(question)],
    })

    expect(result.result.response).toBe('Use SQLite')
    expect(await listQuestions($)).toStrictEqual([])
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
  'answered tool rejects blanks, preserves a repeated question label, and draws newest entries with controls',
  async ($: any, on: any) => {
    const { clock } = setup(on)
    await clearBoard($)

    const missingQuestion = await $.tool.call({
      tool: ANSWERED_TOOL,
      question: '   ',
      answer: 'An answer.',
    })
    const missingAnswer = await $.tool.call({
      tool: ANSWERED_TOOL,
      question: 'A question?',
      answer: '   ',
    })

    const nothingAdded =
      'Nothing was added: an entry needs both a question and an answer.'
    expect(missingQuestion).toStrictEqual({ result: nothingAdded })
    expect(missingAnswer).toStrictEqual({ result: nothingAdded })

    const ui = await $.ui.mount(PANE('dock', 100, 40))
    let tree = await ui.drawn()
    expect(textOf(borderedBoxes(tree)[2])).toContain(
      'No answered questions yet.',
    )

    const first = await $.tool.call({
      tool: ANSWERED_TOOL,
      question: '  How should data be stored?  ',
      answer: '  Use Postgres.  ',
    })
    expect(first).toStrictEqual({
      result: 'Added to the Answered box as A1.',
    })

    tree = await ui.drawn()
    expect(rowWith(tree, 2, 'How should data be stored?')).toContain(
      'A1 How should data be stored?',
    )
    const oldDone = rowButton(
      tree,
      2,
      'How should data be stored?',
      'done-',
    )
    const oldJump = rowButton(tree, 2, 'Use Postgres.', 'jump-')
    expect(oldDone).toBeDefined()
    expect(oldJump).toBeDefined()
    const oldRowId = oldDone.props.key.slice('done-'.length)
    expect(oldJump.props.key).toBe('jump-' + oldRowId)

    await clock.advance(60_000)
    const second = await $.tool.call({
      tool: ANSWERED_TOOL,
      question: 'Which port should be used?',
      answer: 'Use port 5432.',
    })
    expect(second).toStrictEqual({
      result: 'Added to the Answered box as A2.',
    })

    await clock.advance(60_000)
    const replacement = await $.tool.call({
      tool: ANSWERED_TOOL,
      question: 'How should data be stored?',
      answer: 'Use SQLite.',
    })
    expect(replacement).toStrictEqual({
      result: 'Added to the Answered box as A1.',
    })

    tree = await ui.drawn()
    const answerBox = borderedBoxes(tree)[2]
    const answeredText = textOf(answerBox)
    const rows = boxRows(tree, 2).join('\n')

    expect(answeredText).toContain(
      'Answered 2 · ○ done · ↑ scroll back',
    )
    expect(answeredText).not.toContain('Use Postgres.')
    expect(rowWith(tree, 2, 'How should data be stored?')).toContain(
      'A1 How should data be stored?',
    )
    expect(rowWith(tree, 2, 'Which port should be used?')).toContain(
      'A2 Which port should be used?',
    )
    expect(rows.indexOf('How should data be stored?')).toBeGreaterThanOrEqual(0)
    expect(rows.indexOf('Use SQLite.')).toBeGreaterThan(
      rows.indexOf('How should data be stored?'),
    )
    expect(rows.indexOf('Which port should be used?')).toBeGreaterThan(
      rows.indexOf('Use SQLite.'),
    )
    expect(rowWith(tree, 2, 'How should data be stored?')).toContain(
      timeAt(BASE_TIME + 2 * 60_000),
    )
    expect(rowWith(tree, 2, 'Which port should be used?')).toContain(
      timeAt(BASE_TIME + 60_000),
    )

    const replacedDone = rowButton(
      tree,
      2,
      'How should data be stored?',
      'done-',
    )
    const replacedJump = rowButton(tree, 2, 'Use SQLite.', 'jump-')
    expect(replacedDone).toBeDefined()
    expect(replacedDone.props.label).toBe('○')
    expect(replacedJump).toBeDefined()
    expect(replacedJump.props.label).toBe('↑')

    const replacedRowId = replacedDone.props.key.slice('done-'.length)
    expect(replacedJump.props.key).toBe('jump-' + replacedRowId)
    expect(replacedRowId).not.toBe(oldRowId)
    expect(
      await ui.find({ type: 'Button', key: 'done-' + oldRowId }),
    ).toBeUndefined()
    expect(
      await ui.find({ type: 'Button', key: 'jump-' + oldRowId }),
    ).toBeUndefined()

    await ui.unmount()
  },
)

test(
  'answered controls sit on the labeled question row and first answer row',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)

    await $.tool.call({
      tool: ANSWERED_TOOL,
      question: 'ABCDEFGHIJKLMNO?',
      answer: 'abcdefghijklmnop.',
    })

    const ui = await $.ui.mount(PANE('dock', 24, 40))
    const tree = await ui.drawn()
    const answerBox = borderedBoxes(tree)[2]

    expect(textOf(answerBox)).toContain(
      'Answered 1 · ○ done · ↑ scroll back',
    )

    const done = rowButton(tree, 2, 'A1', 'done-')
    const jump = rowButton(tree, 2, 'abcdefghijkl', 'jump-')
    expect(done).toBeDefined()
    expect(done.props.label).toBe('○')
    expect(jump).toBeDefined()
    expect(jump.props.label).toBe('↑')
    expect(
      (await ui.findAll({ type: 'Button' })).filter(
        button =>
          button.key?.startsWith('done-') ||
          button.key?.startsWith('jump-'),
      ),
    ).toHaveLength(2)

    const rowId = done.props.key.slice('done-'.length)
    expect(jump.props.key).toBe('jump-' + rowId)
    expect(rowButton(tree, 2, 'A1', 'jump-')).toBeUndefined()
    expect(rowButton(tree, 2, 'ABCDEFGHIJKL', 'done-')).toBeUndefined()
    expect(rowButton(tree, 2, 'ABCDEFGHIJKL', 'jump-')).toBeUndefined()
    expect(rowButton(tree, 2, 'MNO?', 'done-')).toBeUndefined()
    expect(rowButton(tree, 2, 'MNO?', 'jump-')).toBeUndefined()
    expect(rowButton(tree, 2, 'abcdefghijkl', 'done-')).toBeUndefined()
    expect(rowButton(tree, 2, 'mnop.', 'done-')).toBeUndefined()
    expect(rowButton(tree, 2, 'mnop.', 'jump-')).toBeUndefined()

    await ui.unmount()
  },
)

test(
  'answered done buttons remove only their entry and checked-off labels are not reused',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)

    const older = await $.tool.call({
      tool: ANSWERED_TOOL,
      question: 'Older answered question?',
      answer: 'Older answer.',
    })
    const newer = await $.tool.call({
      tool: ANSWERED_TOOL,
      question: 'Newer answered question?',
      answer: 'Newer answer.',
    })
    expect(older).toStrictEqual({
      result: 'Added to the Answered box as A1.',
    })
    expect(newer).toStrictEqual({
      result: 'Added to the Answered box as A2.',
    })

    const ui = await $.ui.mount(PANE('dock', 100, 40))
    let tree = await ui.drawn()
    const olderDone = rowButton(
      tree,
      2,
      'Older answered question?',
      'done-',
    )
    const newerDone = rowButton(
      tree,
      2,
      'Newer answered question?',
      'done-',
    )
    expect(olderDone).toBeDefined()
    expect(newerDone).toBeDefined()

    await ui.press({ key: newerDone.props.key })

    tree = await ui.drawn()
    let answeredText = textOf(borderedBoxes(tree)[2])
    expect(answeredText).toContain(
      'Answered 1 · ○ done · ↑ scroll back',
    )
    expect(answeredText).toContain('A1 Older answered question?')
    expect(answeredText).toContain('Older answer.')
    expect(answeredText).not.toContain('Newer answered question?')
    expect(answeredText).not.toContain('Newer answer.')
    expect(
      await ui.find({ type: 'Button', key: olderDone.props.key }),
    ).toBeDefined()
    expect(
      await ui.find({ type: 'Button', key: newerDone.props.key }),
    ).toBeUndefined()

    const readded = await $.tool.call({
      tool: ANSWERED_TOOL,
      question: 'Newer answered question?',
      answer: 'Replacement answer.',
    })
    expect(readded).toStrictEqual({
      result: 'Added to the Answered box as A3.',
    })

    tree = await ui.drawn()
    answeredText = textOf(borderedBoxes(tree)[2])
    expect(answeredText).toContain('A3 Newer answered question?')
    expect(answeredText).toContain('Replacement answer.')
    expect(answeredText).not.toContain('Newer answer.')

    const readdedDone = rowButton(
      tree,
      2,
      'Newer answered question?',
      'done-',
    )
    expect(readdedDone).toBeDefined()
    expect(readdedDone.props.key).not.toBe(newerDone.props.key)

    await ui.press({ key: readdedDone.props.key })
    expect(textOf(borderedBoxes(await ui.drawn())[2])).toContain(
      'A1 Older answered question?',
    )

    await ui.press({ key: olderDone.props.key })

    tree = await ui.drawn()
    answeredText = textOf(borderedBoxes(tree)[2])
    expect(answeredText).toContain('No answered questions yet.')
    expect(answeredText).not.toContain('Older answered question?')
    expect(
      (await ui.findAll({ type: 'Button' })).filter(
        button =>
          button.key?.startsWith('done-') ||
          button.key?.startsWith('jump-'),
      ),
    ).toHaveLength(0)

    await ui.unmount()
  },
)

test(
  'answered tool keeps only the newest 30 entries without reusing an evicted label',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)

    for (let index = 1; index <= 31; index += 1) {
      await $.tool.call({
        tool: ANSWERED_TOOL,
        question: `Question ${index}?`,
        answer: `Answer ${index}.`,
      })
    }

    const ui = await $.ui.mount(PANE('inline', 120, 10))
    let tree = await ui.drawn()
    let all = textOf(tree)

    expect(borderedBoxes(tree)).toHaveLength(1)
    expect(all).toContain('Answered 30 · ○ done · ↑ scroll back')
    expect(all).toContain('A31 Question 31?')
    expect(all.indexOf('Question 31?')).toBeGreaterThanOrEqual(0)
    expect(all.indexOf('Question 30?')).toBeGreaterThanOrEqual(0)
    expect(all.indexOf('Question 31?')).toBeLessThan(
      all.indexOf('Question 30?'),
    )

    const newestJump = rowButton(tree, 0, 'Answer 31.', 'jump-')
    expect(newestJump).toBeDefined()
    expect(newestJump.props.label).toBe('↑')

    await scrollBoard($, 1000, 10)
    tree = await ui.drawn()
    all = textOf(tree)

    expect(all).toContain('A2 Question 2?')
    expect(all).toContain('Answer 2.')
    expect(all).not.toContain('Question 1?')
    expect(all).not.toContain('Answer 1.')

    const readded = await $.tool.call({
      tool: ANSWERED_TOOL,
      question: 'Question 1?',
      answer: 'A new answer 1.',
    })
    expect(readded).toStrictEqual({
      result: 'Added to the Answered box as A32.',
    })

    await ui.unmount()
  },
)

test(
  'pull-request tool rejects malformed reports and never reuses a removed label',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)

    const ui = await $.ui.mount(PANE('dock', 100, 40))
    const badName = await $.tool.call({
      tool: PRS_TOOL,
      name: '   ',
      stage: 'open',
      ok: true,
    })
    expect(badName).toStrictEqual({
      result: 'Nothing was changed: a pull request needs a name.',
    })

    const invalidMessage =
      'Nothing was changed: `stage` must be pre_pr, open, ci, deploy or live, and `ok` must be true or false.'

    const badStage = await $.tool.call({
      tool: PRS_TOOL,
      name: 'Release',
      stage: 'unknown',
      ok: true,
    } as any)
    const missingStage = await $.tool.call({
      tool: PRS_TOOL,
      name: 'Release',
      ok: true,
    } as any)
    const badOk = await $.tool.call({
      tool: PRS_TOOL,
      name: 'Release',
      stage: 'open',
      ok: 'yes',
    } as any)

    expect(badStage).toStrictEqual({ result: invalidMessage })
    expect(missingStage).toStrictEqual({ result: invalidMessage })
    expect(badOk).toStrictEqual({ result: invalidMessage })

    let tree = await ui.drawn()
    expect(textOf(borderedBoxes(tree)[3])).toContain(
      'No pull requests in progress.',
    )

    const added = await $.tool.call({
      tool: PRS_TOOL,
      name: '  Release  ',
      number: 17,
      stage: 'pre_pr',
      ok: true,
      status: '  Running tests.  ',
    })
    expect(added).toStrictEqual({
      result:
        'P1 Release: stage 1 of 5 (Pre-PR: running the test suites), ok.',
    })

    tree = await ui.drawn()
    const beforeInvalidUpdate = textOf(borderedBoxes(tree)[3])
    expect(rowWith(tree, 3, 'Release #17')).toContain('P1 Release #17')
    expect(beforeInvalidUpdate).toContain('Running tests.')

    const rejected = await $.tool.call({
      tool: PRS_TOOL,
      name: 'Release',
      stage: 'broken',
      ok: false,
    } as any)
    expect(rejected).toStrictEqual({ result: invalidMessage })
    expect(textOf(borderedBoxes(await ui.drawn())[3])).toBe(
      beforeInvalidUpdate,
    )

    const removed = await $.tool.call({
      tool: PRS_TOOL,
      name: ' Release ',
      remove: true,
    })
    expect(removed).toStrictEqual({ result: 'Release is off the board.' })

    tree = await ui.drawn()
    expect(textOf(borderedBoxes(tree)[3])).toContain(
      'No pull requests in progress.',
    )
    expect(textOf(borderedBoxes(tree)[3])).not.toContain('Release #17')

    const readded = await $.tool.call({
      tool: PRS_TOOL,
      name: 'Release',
      stage: 'live',
      ok: false,
      status: 'Needs attention.',
    })
    expect(readded).toStrictEqual({
      result: 'P2 Release: stage 5 of 5 (Live), not ok.',
    })

    tree = await ui.drawn()
    expect(rowWith(tree, 3, 'Release')).toContain('P2 Release')
    expect(textOf(borderedBoxes(tree)[3])).not.toContain('#17')

    await ui.unmount()
  },
)

test(
  'pull-request updates keep label, order, and number while the newest ten names are retained',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)

    const first = await $.tool.call({
      tool: PRS_TOOL,
      name: 'PR A',
      number: 41,
      stage: 'open',
      ok: true,
      status: 'Opened.',
    })
    const second = await $.tool.call({
      tool: PRS_TOOL,
      name: 'PR B',
      stage: 'ci',
      ok: false,
      status: 'Tests failed.',
    })
    const update = await $.tool.call({
      tool: PRS_TOOL,
      name: ' PR A ',
      stage: 'deploy',
      ok: true,
      status: 'Deploying.',
    })

    expect(first).toStrictEqual({
      result: 'P1 PR A: stage 2 of 5 (PR open), ok.',
    })
    expect(second).toStrictEqual({
      result: 'P2 PR B: stage 3 of 5 (CI tests running), not ok.',
    })
    expect(update).toStrictEqual({
      result:
        'P1 PR A: stage 4 of 5 (Merging and deploying), ok.',
    })

    const ui = await $.ui.mount(PANE('dock', 120, 100))
    let tree = await ui.drawn()
    let rows = boxRows(tree, 3)
    let all = textOf(borderedBoxes(tree)[3])
    const bIndex = rows.findIndex(row => row.includes('PR B'))
    const aIndex = rows.findIndex(row => row.includes('PR A #41'))

    expect(bIndex).toBeGreaterThanOrEqual(0)
    expect(aIndex).toBeGreaterThan(bIndex)
    expect(rows[bIndex]).toContain('P2 PR B')
    expect(rows[aIndex]).toContain('P1 PR A #41')
    expect(rows[aIndex]).toContain('✔')
    expect(rows[aIndex + 1]).toContain(
      '■■■■□ 4/5 Merging and deploying',
    )
    expect(rows[aIndex + 2]).toContain('Deploying.')
    expect(all).not.toContain('Opened.')

    for (const letter of ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']) {
      await $.tool.call({
        tool: PRS_TOOL,
        name: `PR ${letter}`,
        stage: 'pre_pr',
        ok: true,
      })
    }

    tree = await ui.drawn()
    all = textOf(borderedBoxes(tree)[3])
    expect(all).toContain('Pull requests 10 · 1 not ok')
    expect(rowWith(tree, 3, 'PR K')).toContain('P11 PR K')

    const expectedOrder = [
      'PR K',
      'PR J',
      'PR I',
      'PR H',
      'PR G',
      'PR F',
      'PR E',
      'PR D',
      'PR C',
      'PR B',
    ]
    for (let index = 1; index < expectedOrder.length; index += 1) {
      expect(all.indexOf(expectedOrder[index - 1])).toBeLessThan(
        all.indexOf(expectedOrder[index]),
      )
    }
    expect(all).not.toContain('PR A')

    await ui.unmount()
  },
)

test(
  'pull-request drawing shows every label, stage, health mark, status, number, and title summary',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)

    const stages = [
      {
        name: 'Prep release',
        stage: 'pre_pr',
        ok: true,
        label: 'Pre-PR: running the test suites',
        status: 'Full suite is running.',
      },
      {
        name: 'Open release',
        stage: 'open',
        ok: true,
        label: 'PR open',
        status: 'Awaiting review.',
        number: 12,
      },
      {
        name: 'CI release',
        stage: 'ci',
        ok: false,
        label: 'CI tests running',
        status: 'One test is failing.',
      },
      {
        name: 'Deploy release',
        stage: 'deploy',
        ok: true,
        label: 'Merging and deploying',
        status: 'Deployment is healthy.',
      },
      {
        name: 'Live release',
        stage: 'live',
        ok: true,
        label: 'Live',
        status: 'Released.',
      },
    ] as const

    for (let index = 0; index < stages.length; index += 1) {
      const one = stages[index]
      const result = await $.tool.call({
        tool: PRS_TOOL,
        name: one.name,
        stage: one.stage,
        ok: one.ok,
        status: one.status,
        ...('number' in one ? { number: one.number } : {}),
      })

      expect(result).toStrictEqual({
        result: `P${index + 1} ${one.name}: stage ${index + 1} of 5 (${one.label}), ${
          one.ok ? 'ok' : 'not ok'
        }.`,
      })
    }

    const ui = await $.ui.mount(PANE('dock', 120, 60))
    let tree = await ui.drawn()
    let prBox = borderedBoxes(tree)[3]
    let all = textOf(prBox)

    expect(all).toContain('Pull requests 5 · 1 not ok')
    expect(all.indexOf('Live release')).toBeLessThan(
      all.indexOf('Prep release'),
    )

    for (let index = 0; index < stages.length; index += 1) {
      const one = stages[index]
      const place = index + 1
      const strip = `${'■'.repeat(place)}${'□'.repeat(5 - place)}`
      const shownName =
        'number' in one ? `${one.name} #${one.number}` : one.name
      const titleRow = rowWith(tree, 3, shownName)

      expect(titleRow).toContain(`P${place} ${shownName}`)
      expect(titleRow).toContain(one.ok ? '✔' : '✖')
      expect(all).toContain(`${strip} ${place}/5 ${one.label}`)
      expect(all).toContain(one.status)
    }

    const recovered = await $.tool.call({
      tool: PRS_TOOL,
      name: 'CI release',
      stage: 'ci',
      ok: true,
      status: 'Tests recovered.',
    })
    expect(recovered).toStrictEqual({
      result:
        'P3 CI release: stage 3 of 5 (CI tests running), ok.',
    })

    tree = await ui.drawn()
    prBox = borderedBoxes(tree)[3]
    all = textOf(prBox)

    expect(all).toContain('Pull requests 5 · all ok')
    expect(rowWith(tree, 3, 'CI release')).toContain('P3 CI release')
    expect(rowWith(tree, 3, 'CI release')).toContain('✔')
    expect(all).toContain('Tests recovered.')
    expect(all).not.toContain('One test is failing.')

    await ui.unmount()
  },
)

test(
  'session.end clear and resume empty all four boxes, reset four offsets, and restart every label sequence',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)
    await populateTallBoard($)

    const bodyRows = 32
    const ui = await $.ui.mount(PANE('dock', 80, bodyRows))

    for (const reason of ['clear', 'resume'] as const) {
      await scrollBoard($, -1000, bodyRows)
      const topTree = await ui.drawn()
      const topRows = BOX_NAMES.map((_, index) =>
        boxRows(topTree, index),
      )

      await scrollBoard($, 2, bodyRows)
      const scrolledTree = await ui.drawn()

      for (let index = 0; index < BOX_NAMES.length; index += 1) {
        const name = BOX_NAMES[index]
        expect(await ui.find({ key: `${name}-up` })).toBeDefined()
        expect(boxRows(scrolledTree, index)).not.toStrictEqual(
          topRows[index],
        )
      }

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
      expect(empty).toContain('No answered questions yet.')
      expect(empty).toContain('No pull requests in progress.')

      await populateTallBoard($)

      expect(
        (await listQuestions($)).map(question => question.id),
      ).toStrictEqual(
        Array.from({ length: 10 }, (_, index) => `Q${index + 1}`),
      )

      const resetTree = await ui.drawn()
      for (let index = 0; index < BOX_NAMES.length; index += 1) {
        expect(boxRows(resetTree, index)).toStrictEqual(topRows[index])
        expect(
          await ui.find({ key: `${BOX_NAMES[index]}-up` }),
        ).toBeUndefined()
      }
    }

    await ui.unmount()
  },
)

test(
  'session.end with another reason preserves all board state, labels, and four scroll offsets',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)
    await populateTallBoard($)

    const bodyRows = 32
    const ui = await $.ui.mount(PANE('dock', 80, bodyRows))
    await scrollBoard($, -1000, bodyRows)
    await scrollBoard($, 2, bodyRows)

    for (const name of BOX_NAMES) {
      expect(await ui.find({ key: `${name}-up` })).toBeDefined()
    }

    const beforeTree = await ui.drawn()
    const drawingBefore = textOf(beforeTree)
    const rowsBefore = BOX_NAMES.map((_, index) =>
      boxRows(beforeTree, index),
    )
    const questionsBefore = await listQuestions($)

    const sessionId = 'session-prompt-input-exit'
    const ended = await $.session.end({
      reason: 'prompt_input_exit',
      sessionId,
      resume: {},
    })

    expect(ended).toStrictEqual({ sessionId })

    const afterTree = await ui.drawn()
    expect(textOf(afterTree)).toBe(drawingBefore)
    for (let index = 0; index < BOX_NAMES.length; index += 1) {
      expect(boxRows(afterTree, index)).toStrictEqual(rowsBefore[index])
      expect(
        await ui.find({ key: `${BOX_NAMES[index]}-up` }),
      ).toBeDefined()
    }
    expect(await listQuestions($)).toStrictEqual(questionsBefore)

    const afterAdd = parseQuestions(
      await $.tool.call({
        tool: QUESTIONS_TOOL,
        add: ['Question after exit?'],
        resolve: [],
      }),
    )
    expect(afterAdd.at(-1)).toStrictEqual({
      id: 'Q11',
      text: 'Question after exit?',
    })

    await ui.unmount()
  },
)

test(
  'subagent calls to all four sticky-board tools report no change and preserve the main board',
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
    await $.tool.call({
      tool: ANSWERED_TOOL,
      question: 'Main answered question?',
      answer: 'Main answer.',
    })
    await $.tool.call({
      tool: PRS_TOOL,
      name: 'Main PR',
      stage: 'open',
      ok: true,
    })

    const ui = await $.ui.mount(PANE('dock', 100, 40))
    const before = textOf(await ui.drawn())
    const questionsBefore = await listQuestions($)

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
    const answerResult = await $.tool.call({
      tool: ANSWERED_TOOL,
      question: 'Subagent answered question?',
      answer: 'Subagent answer.',
      agentId: 'agent-1',
    } as any)
    const prResult = await $.tool.call({
      tool: PRS_TOOL,
      name: 'Main PR',
      remove: true,
      agentId: 'agent-1',
    } as any)

    const unchanged =
      'Only the main conversation keeps the sticky board; nothing was changed.'
    expect(taskResult).toEqual({ result: unchanged })
    expect(questionResult).toEqual({ result: unchanged })
    expect(answerResult).toEqual({ result: unchanged })
    expect(prResult).toEqual({ result: unchanged })
    expect(await listQuestions($)).toStrictEqual(questionsBefore)

    const all = textOf(await ui.drawn())
    expect(all).toBe(before)
    expect(all).toContain('Main task')
    expect(all).toContain('Main question?')
    expect(all).toContain('Main answered question?')
    expect(all).toContain('Main PR')
    expect(all).not.toContain('Subagent task')
    expect(all).not.toContain('Subagent question?')
    expect(all).not.toContain('Subagent answered question?')

    await ui.unmount()
  },
)

test(
  'answer fallback joins unmarked continuation lines, handles closing quotes and e.g., and draws newest first',
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
      '> "Could we use',
      'SQLite?"',
      '- Could we use e.g. Postgres?',
      '- Third fallback? This sentence is not a question.',
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
      'Could we use SQLite?',
      'Could we use e.g. Postgres?',
      'Third fallback?',
    ])

    const ui = await $.ui.mount(PANE('dock', 100, 40))
    const all = textOf(await ui.drawn())

    expect(all).not.toContain(
      'Should this question in an earlier paragraph be ignored?',
    )
    expect(all).not.toContain('> "Could we use')
    expect(all).toContain('Could we use SQLite?')
    expect(all.indexOf('Third fallback?')).toBeLessThan(
      all.indexOf('Could we use e.g. Postgres?'),
    )
    expect(all.indexOf('Could we use e.g. Postgres?')).toBeLessThan(
      all.indexOf('Could we use SQLite?'),
    )
    expect(all.indexOf('Could we use SQLite?')).toBeLessThan(
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
  'prompt.submit appends open-question and named-entry context for all person origins',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)

    await $.tool.call({
      tool: TASKS_TOOL,
      tasks: Array.from({ length: 32 }, (_, index) => ({
        subject:
          index === 0
            ? 'Named task'
            : index === 31
              ? 'FAT task must stay unnamed'
              : `Filler task ${index + 1}`,
        status: index === 0 ? 'in_progress' : 'pending',
      })),
    })
    const questions = parseQuestions(
      await $.tool.call({
        tool: QUESTIONS_TOOL,
        add: ['First open question?', 'Second open question?'],
        resolve: [],
      }),
    )
    await $.tool.call({
      tool: ANSWERED_TOOL,
      question: 'Which database?',
      answer: 'Use SQLite.',
    })
    await $.tool.call({
      tool: PRS_TOOL,
      name: 'Release candidate',
      number: 42,
      stage: 'ci',
      ok: false,
      status: 'Tests failed.',
    })

    expect(questions).toStrictEqual([
      { id: 'Q1', text: 'First open question?' },
      { id: 'Q2', text: 'Second open question?' },
    ])

    const questionContext = [
      "Open questions on the user's sticky board:",
      '- Q1: First open question?',
      '- Q2: Second open question?',
      'If this message answers any of them, or one no longer matters, resolve it with mcp__sticky-board__questions.',
    ].join('\n')
    const namedContext = [
      "Entries on the user's sticky board that this message names:",
      '- T1: the task "Named task" (in_progress)',
      '- A1: they asked "Which database?" and your answer was "Use SQLite."',
      '- P1: the pull request "Release candidate" #42, CI tests running, not ok: Tests failed.',
    ].join('\n')

    for (const kind of ['composer', 'bridge', 'sdk', 'slack-ping'] as const) {
      const text =
        `Reply through ${kind} about t1, A1, and p1; ` +
        'ignore T99 and FAT32.'
      const result = await $.prompt.submit({
        text,
        context: ['existing context'],
        wait: false,
        origin: { kind },
      })

      expect(result.text).toBe(text)
      expect(result.context).toStrictEqual([
        'existing context',
        questionContext,
        namedContext,
      ])
    }
  },
)

test(
  'prompt.submit passes non-person origins through without adding question or named-entry context',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)

    await $.tool.call({
      tool: TASKS_TOOL,
      tasks: [{ subject: 'Still pending', status: 'pending' }],
    })
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
      { kind: 'plugin', name: 'another-plugin' },
    ]

    for (const origin of origins) {
      const text = `Message from ${origin.kind} about T1`
      const result = await $.prompt.submit({
        text,
        context: ['keep this'],
        wait: false,
        origin,
      })

      expect(result).toStrictEqual({
        text,
        context: ['keep this'],
      })
    }
  },
)

test(
  'prompt.submit omits context when nothing is named and supports named-only context',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)

    const unchanged = await $.prompt.submit({
      text: 'Nothing to resolve or identify.',
      context: ['existing context'],
      wait: false,
      origin: { kind: 'composer' },
    })

    expect(unchanged).toStrictEqual({
      text: 'Nothing to resolve or identify.',
      context: ['existing context'],
    })

    await $.tool.call({
      tool: PRS_TOOL,
      name: 'Context PR',
      stage: 'open',
      ok: true,
    })

    const named = await $.prompt.submit({
      text: 'What changed in p1?',
      wait: false,
      origin: { kind: 'composer' },
    })

    expect(named).toStrictEqual({
      text: 'What changed in p1?',
      context: [
        [
          "Entries on the user's sticky board that this message names:",
          '- P1: the pull request "Context PR", PR open, ok',
        ].join('\n'),
      ],
    })
  },
)

test(
  'prompt.compose keeps existing sections and appends the sticky-board session section when all four tools are available',
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
      tools: ['Bash', ...BOARD_TOOLS],
      outputStyle: null,
      traits: [],
    })

    expect(result.sections).toHaveLength(3)
    expect(result.sections.slice(0, 2)).toStrictEqual(base)
    expect(result.sections[2].id).toBe('sticky-board:questions')
    expect(result.sections[2].scope).toBe('session')

    for (const tool of BOARD_TOOLS) {
      expect(result.sections[2].text).toContain(tool)
    }
    for (const label of ['T3', 'Q2', 'A1', 'P1']) {
      expect(result.sections[2].text).toContain(label)
    }
  },
)

test(
  'prompt.compose adds nothing without a surface or when any sticky-board tool is missing',
  async ($: any, on: any) => {
    const { controls } = setup(on)
    const base = [{ id: 'intro', text: 'Base prompt.', scope: 'shared' }]
    controls.sections = base

    const withoutSurface = await $.prompt.compose({
      model: 'test-model',
      promptModel: 'test-model',
      surfaces: [],
      tools: [...BOARD_TOOLS],
      outputStyle: null,
      traits: [],
    })

    expect(withoutSurface).toStrictEqual({ sections: base })

    for (const missing of BOARD_TOOLS) {
      const withoutOneTool = await $.prompt.compose({
        model: 'test-model',
        promptModel: 'test-model',
        surfaces: ['terminal'],
        tools: BOARD_TOOLS.filter(tool => tool !== missing),
        outputStyle: null,
        traits: [],
      })

      expect(withoutOneTool).toStrictEqual({ sections: base })
    }
  },
)

test(
  'inline draws only populated boxes at shared widths while dock always draws all four',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)

    const emptyInline = await $.ui.mount(PANE('inline', 81, 30))
    let tree: any = await emptyInline.drawn()
    let boxes = borderedBoxes(tree)

    expect(tree.type).toBe('Box')
    expect(tree.props.flexDirection).toBe('row')
    expect(boxes).toHaveLength(1)
    expect(boxes[0].props.width).toBe(81)
    expect(textOf(boxes[0])).toContain('Tasks')
    expect(textOf(boxes[0])).toContain('No tasks yet.')
    expect(textOf(tree)).not.toContain('No open questions.')
    expect(textOf(tree)).not.toContain('No answered questions yet.')
    expect(textOf(tree)).not.toContain('No pull requests in progress.')

    await emptyInline.unmount()

    const emptyDock = await $.ui.mount(PANE('dock', 81, 30))
    tree = await emptyDock.drawn()
    boxes = borderedBoxes(tree)

    expect(tree.type).toBe('Box')
    expect(tree.props.flexDirection).toBe('column')
    expect(boxes).toHaveLength(4)
    expect(boxes.map(box => box.props.width)).toStrictEqual([
      81,
      81,
      81,
      81,
    ])
    expect(textOf(boxes[0])).toContain('No tasks yet.')
    expect(textOf(boxes[1])).toContain('No open questions.')
    expect(textOf(boxes[2])).toContain('No answered questions yet.')
    expect(textOf(boxes[3])).toContain('No pull requests in progress.')

    await emptyDock.unmount()

    await $.tool.call({
      tool: TASKS_TOOL,
      tasks: [{ subject: 'Inline task', status: 'pending' }],
    })
    await $.tool.call({
      tool: ANSWERED_TOOL,
      question: 'Inline answered question?',
      answer: 'Inline answer.',
    })

    const partialInline = await $.ui.mount(PANE('inline', 83, 30))
    tree = await partialInline.drawn()
    boxes = borderedBoxes(tree)

    expect(boxes).toHaveLength(2)
    expect(boxes.map(box => box.props.width)).toStrictEqual([41, 41])
    expect(textOf(boxes[0])).toContain('Tasks')
    expect(textOf(boxes[0])).toContain('T1 Inline task')
    expect(textOf(boxes[1])).toContain('Answered')
    expect(textOf(boxes[1])).toContain('A1 Inline answered question?')
    expect(textOf(tree)).not.toContain('Open questions')
    expect(textOf(tree)).not.toContain('Pull requests')

    await partialInline.unmount()

    await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: ['Inline open question?'],
      resolve: [],
    })
    await $.tool.call({
      tool: PRS_TOOL,
      name: 'Inline PR',
      stage: 'open',
      ok: true,
    })

    const fullInline = await $.ui.mount(PANE('inline', 83, 30))
    tree = await fullInline.drawn()
    boxes = borderedBoxes(tree)

    expect(boxes).toHaveLength(4)
    expect(boxes.map(box => box.props.width)).toStrictEqual([
      20,
      20,
      20,
      20,
    ])

    for (let index = 0; index < 4; index += 1) {
      expect(textOf(boxes[index])).toContain(
        ['Tasks', 'Open questions', 'Answered', 'Pull requests'][index],
      )
    }

    await fullInline.unmount()
  },
)

test(
  'long labeled task and question text wrap onto following rows without truncation',
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

    const ui = await $.ui.mount(PANE('dock', 24, 20))
    const tree = await ui.drawn()
    const taskRows = boxRows(tree, 0)
    const questionRows = boxRows(tree, 1)

    const taskLabel = taskRows.findIndex(row => row.includes('T1'))
    const taskFirst = taskRows.findIndex(row => row.includes('abcdefghijkl'))
    const taskSecond = taskRows.findIndex(row => row.includes('mnopqrstuvwx'))
    const questionLabel = questionRows.findIndex(row => row.includes('Q1'))
    const questionFirst = questionRows.findIndex(row =>
      row.includes('ABCDEFGHIJKL'),
    )
    const questionSecond = questionRows.findIndex(row =>
      row.includes('MNOPQRSTUVW?'),
    )

    expect(taskLabel).toBeGreaterThanOrEqual(0)
    expect(taskFirst).toBe(taskLabel + 1)
    expect(taskSecond).toBe(taskFirst + 1)
    expect(questionLabel).toBeGreaterThanOrEqual(0)
    expect(questionFirst).toBe(questionLabel + 1)
    expect(questionSecond).toBe(questionFirst + 1)
    expect(await ui.find({ type: 'Text', text: longTask })).toBeUndefined()
    expect(
      await ui.find({ type: 'Text', text: longQuestion }),
    ).toBeUndefined()

    await ui.unmount()
  },
)

test(
  'paging buttons move only their own one of the four boxes',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)
    await populateTallBoard($)

    const bodyRows = 8
    const ui = await $.ui.mount(PANE('inline', 80, bodyRows))
    await scrollBoard($, -1000, bodyRows)

    for (const name of BOX_NAMES) {
      expect(await ui.find({ key: `${name}-down` })).toBeDefined()
      expect(await ui.find({ key: `${name}-up` })).toBeUndefined()
    }

    for (const name of BOX_NAMES) {
      await ui.press({ key: `${name}-down` })

      for (const other of BOX_NAMES) {
        if (other === name) {
          expect(await ui.find({ key: `${other}-up` })).toBeDefined()
        } else {
          expect(await ui.find({ key: `${other}-up` })).toBeUndefined()
        }
      }

      await ui.press({ key: `${name}-up` })

      for (const other of BOX_NAMES) {
        expect(await ui.find({ key: `${other}-up` })).toBeUndefined()
      }
    }

    await ui.unmount()
  },
)

test(
  'ui.scroll moves only the pointed box and moves all four boxes without a pointer',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)
    await populateTallBoard($)

    const layouts = [
      {
        placement: 'inline' as const,
        columns: 80,
        rows: 8,
        pointers: {
          tasks: { column: 2, row: 2 },
          questions: { column: 22, row: 2 },
          answers: { column: 42, row: 2 },
          prs: { column: 62, row: 2 },
        },
      },
      {
        placement: 'dock' as const,
        columns: 80,
        rows: 32,
        pointers: {
          tasks: { column: 2, row: 2 },
          questions: { column: 2, row: 10 },
          answers: { column: 2, row: 18 },
          prs: { column: 2, row: 26 },
        },
      },
    ]

    for (const layout of layouts) {
      const ui = await $.ui.mount(
        PANE(layout.placement, layout.columns, layout.rows),
      )

      for (const name of BOX_NAMES) {
        await scrollBoard($, -1000, layout.rows)

        for (const other of BOX_NAMES) {
          expect(await ui.find({ key: `${other}-up` })).toBeUndefined()
        }

        const moved = await scrollBoard(
          $,
          2,
          layout.rows,
          layout.pointers[name],
        )

        expect(moved).toStrictEqual({})

        for (const other of BOX_NAMES) {
          if (other === name) {
            expect(await ui.find({ key: `${other}-up` })).toBeDefined()
          } else {
            expect(await ui.find({ key: `${other}-up` })).toBeUndefined()
          }
        }
      }

      await scrollBoard($, -1000, layout.rows)
      const movedAll = await scrollBoard($, 2, layout.rows)

      expect(movedAll).toStrictEqual({})

      for (const name of BOX_NAMES) {
        expect(await ui.find({ key: `${name}-up` })).toBeDefined()
      }

      await ui.unmount()
    }
  },
)

test(
  'a dock under 16 rows draws every box whole and passes scrolling through, while 16 rows scrolls boxes',
  async ($: any, on: any) => {
    const receivedScrolls: any[] = []
    on('ui.scroll', async (_$: any, e: any) => {
      receivedScrolls.push(e)
      return { deny: 'bottom ui.scroll received it' }
    })
    setup(on)
    await clearBoard($)
    await populateTallBoard($)

    const shortRows = 15
    const short = await $.ui.mount(PANE('dock', 80, shortRows))
    const shortTree = await short.drawn()
    const shortDrawing = textOf(shortTree)

    expect(borderedBoxes(shortTree)).toHaveLength(4)
    expect(
      boxRows(shortTree, 0).filter(row => row.includes('Task item')),
    ).toHaveLength(10)
    expect(
      boxRows(shortTree, 1).filter(row => row.includes('Question item')),
    ).toHaveLength(10)
    expect(
      boxRows(shortTree, 2).filter(row =>
        row.includes('Answered question'),
      ),
    ).toHaveLength(6)
    expect(
      boxRows(shortTree, 2).filter(row => row.includes('Answer item')),
    ).toHaveLength(6)
    expect(
      boxRows(shortTree, 3).filter(row =>
        row.includes('Pull request '),
      ),
    ).toHaveLength(6)
    expect(shortDrawing).toContain('T1 Task item 01')
    expect(shortDrawing).toContain('T10 Task item 10')
    expect(shortDrawing).toContain('Q1 Question item 01?')
    expect(shortDrawing).toContain('Q10 Question item 10?')
    expect(shortDrawing).toContain('A1 Answered question 01?')
    expect(shortDrawing).toContain('A6 Answered question 06?')
    expect(shortDrawing).toContain('P1 Pull request 01')
    expect(shortDrawing).toContain('P6 Pull request 06')

    for (const name of BOX_NAMES) {
      expect(await short.find({ key: `${name}-up` })).toBeUndefined()
      expect(await short.find({ key: `${name}-down` })).toBeUndefined()
    }

    const passedThrough = await scrollBoard(
      $,
      2,
      shortRows,
      { column: 2, row: 2 },
    )
    expect(passedThrough).toStrictEqual({
      deny: 'bottom ui.scroll received it',
    })
    expect(receivedScrolls).toHaveLength(1)
    expect(receivedScrolls[0].requestId).toBe('sticky-board')
    expect(receivedScrolls[0].bodyRows).toBe(shortRows)
    expect(receivedScrolls[0].by).toBe(2)
    expect(textOf(await short.drawn())).toBe(shortDrawing)

    await short.unmount()

    const boundaryRows = 16
    const boundary = await $.ui.mount(PANE('dock', 80, boundaryRows))
    const beforeTree = await boundary.drawn()
    const tasksBefore = boxRows(beforeTree, 0)
    const questionsBefore = boxRows(beforeTree, 1)

    expect(tasksBefore.join('\n')).toContain('T1 Task item 01')
    const intercepted = await scrollBoard(
      $,
      2,
      boundaryRows,
      { column: 2, row: 1 },
    )

    expect(intercepted).toStrictEqual({})
    expect(receivedScrolls).toHaveLength(1)

    const afterTree = await boundary.drawn()
    const tasksAfter = boxRows(afterTree, 0)
    expect(tasksAfter).not.toStrictEqual(tasksBefore)
    expect(tasksAfter.join('\n')).toContain('T3 Task item 03')
    expect(boxRows(afterTree, 1)).toStrictEqual(questionsBefore)

    await boundary.unmount()
  },
)
