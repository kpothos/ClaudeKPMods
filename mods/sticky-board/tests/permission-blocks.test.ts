import { expect, mock, test } from 'claude-code/testing'

const QUESTIONS_TOOL = 'mcp__sticky-board__questions'
const BOARD_TOOLS = [
  'mcp__sticky-board__tasks',
  QUESTIONS_TOOL,
  'mcp__sticky-board__answered',
  'mcp__sticky-board__prs',
  'mcp__sticky-board__design',
] as const
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

const setupClassicBottoms = (
  on: any,
  permissionDeniedResult: any = {},
): void => {
  on(
    'classic.PermissionDenied',
    async () => permissionDeniedResult,
  )
  on('classic.PostToolUse', async () => ({}))
  on('classic.PostToolUseFailure', async () => ({}))
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

const fromLabel = (row: string, label: string): string => {
  const start = row.indexOf(`${label} `)
  return start === -1 ? '' : row.slice(start)
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

const denyAction = (
  $: any,
  toolUseId: string,
  tool: string,
  toolInput: unknown,
  extra: Record<string, unknown> = {},
): Promise<any> =>
  $.classic.PermissionDenied({
    tool_name: tool,
    tool_input: toolInput,
    tool_use_id: toolUseId,
    reason: 'Auto mode denied this action.',
    ...extra,
  })

const finishAction = (
  $: any,
  toolUseId: string,
  tool: string,
  toolInput: unknown,
): Promise<any> =>
  $.classic.PostToolUse({
    tool_name: tool,
    tool_input: toolInput,
    tool_response: { ok: true },
    tool_use_id: toolUseId,
  })

const failAction = (
  $: any,
  toolUseId: string,
  tool: string,
  toolInput: unknown,
): Promise<any> =>
  $.classic.PostToolUseFailure({
    tool_name: tool,
    tool_input: toolInput,
    tool_use_id: toolUseId,
    error: 'The tool failed.',
  })

test(
  'permission blocks draw as counted newest questions and never reuse labels',
  async ($: any, on: any) => {
    setupClassicBottoms(on)
    setup(on)
    await clearBoard($)

    await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: ['Older ordinary question?'],
      resolve: [],
    })

    const firstBlock =
      'Auto mode blocked Bash(echo one). Approve it in /permissions.'
    await denyAction(
      $,
      'denied-one',
      'Bash',
      { command: 'echo one', description: 'First attempt' },
    )

    const ui = await $.ui.mount(PANE('dock', 180, 30))
    let tree = await ui.drawn()
    let rows = boxRows(tree, 1)

    expect(rows[0]).toBe(
      ' Open questions  2 · press ○ when answered',
    )
    expect(fromLabel(rows[1] ?? '', 'Q2')).toBe(`Q2 ${firstBlock}`)
    expect(fromLabel(rows[2] ?? '', 'Q1')).toBe(
      'Q1 Older ordinary question?',
    )

    await finishAction(
      $,
      'ran-one',
      'Bash',
      { command: 'echo one', description: 'Approved attempt' },
    )

    tree = await ui.drawn()
    expect(textOf(tree)).not.toContain(firstBlock)
    expect(rowWith(tree, 1, 'Older ordinary question?')).toContain(
      'Q1 Older ordinary question?',
    )

    const secondBlock =
      'Auto mode blocked Bash(echo two). Approve it in /permissions.'
    await denyAction(
      $,
      'denied-two',
      'Bash',
      { command: 'echo two' },
    )

    tree = await ui.drawn()
    rows = boxRows(tree, 1)

    expect(rows[0]).toBe(
      ' Open questions  2 · press ○ when answered',
    )
    expect(fromLabel(rows[1] ?? '', 'Q3')).toBe(`Q3 ${secondBlock}`)
    expect(fromLabel(rows[2] ?? '', 'Q1')).toBe(
      'Q1 Older ordinary question?',
    )
    expect(textOf(tree)).not.toContain('Q2 Auto mode blocked')

    await ui.unmount()
  },
)

test(
  'duplicate Bash blocks ignore description changes',
  async ($: any, on: any) => {
    setupClassicBottoms(on)
    setup(on)
    await clearBoard($)

    await denyAction(
      $,
      'denied-first',
      'Bash',
      { command: 'npm test', description: 'Run the suite' },
    )
    await denyAction(
      $,
      'denied-second',
      'Bash',
      { command: 'npm test', description: 'Run every test now' },
    )

    const blocked =
      'Auto mode blocked Bash(npm test). Approve it in /permissions.'
    const ui = await $.ui.mount(PANE('dock', 180, 30))
    const tree = await ui.drawn()
    const rows = boxRows(tree, 1)

    expect(rows[0]).toBe(
      ' Open questions  1 · press ○ when answered',
    )
    expect(rows.filter(row => row.includes(blocked))).toHaveLength(1)
    expect(fromLabel(rowWith(tree, 1, blocked), 'Q1')).toBe(
      `Q1 ${blocked}`,
    )

    await ui.unmount()
  },
)

test(
  'permission blocks choose, normalize, and truncate the shown action by character',
  async ($: any, on: any) => {
    setupClassicBottoms(on)
    setup(on)
    await clearBoard($)

    const action81 = 'a'.repeat(81)
    const action80 = 'b'.repeat(80)
    const emojiAtCut = `${'c'.repeat(78)}😀xy`

    await denyAction(
      $,
      'shown-priority',
      'PriorityTool',
      {
        command: '  run \n\t now  ',
        file_path: '/ignored/file',
        url: 'https://ignored.example',
      },
    )
    await denyAction(
      $,
      'shown-file',
      'FileTool',
      {
        command: ' \t\n ',
        file_path: '  /tmp/\n   chosen.txt  ',
        url: 'https://ignored.example',
      },
    )
    await denyAction(
      $,
      'shown-url',
      'UrlTool',
      {
        command: '',
        file_path: '   ',
        url: '  https://example.com/\n  path  ',
      },
    )
    await denyAction(
      $,
      'shown-81',
      'Long81',
      { command: action81 },
    )
    await denyAction(
      $,
      'shown-80',
      'Long80',
      { command: action80 },
    )
    await denyAction(
      $,
      'shown-emoji',
      'EmojiTool',
      { command: emojiAtCut },
    )
    await denyAction(
      $,
      'shown-none',
      'NoActionTool',
      {
        command: 7,
        file_path: null,
        url: ['https://not-a-string.example'],
      },
    )

    const expected = [
      'Auto mode blocked PriorityTool(run now). Approve it in /permissions.',
      'Auto mode blocked FileTool(/tmp/ chosen.txt). Approve it in /permissions.',
      'Auto mode blocked UrlTool(https://example.com/ path). Approve it in /permissions.',
      `Auto mode blocked Long81(${'a'.repeat(79)}…). Approve it in /permissions.`,
      `Auto mode blocked Long80(${action80}). Approve it in /permissions.`,
      `Auto mode blocked EmojiTool(${'c'.repeat(78)}😀…). Approve it in /permissions.`,
      'Auto mode blocked NoActionTool. Approve it in /permissions.',
    ]

    const ui = await $.ui.mount(PANE('dock', 240, 40))
    const tree = await ui.drawn()

    expect(boxRows(tree, 1)[0]).toBe(
      ' Open questions  7 · press ○ when answered',
    )

    for (const [index, text] of expected.entries()) {
      const label = `Q${index + 1}`
      expect(fromLabel(rowWith(tree, 1, text), label)).toBe(
        `${label} ${text}`,
      )
    }

    await ui.unmount()
  },
)

test(
  'post-tool events clear only the matching blocked action',
  async ($: any, on: any) => {
    setupClassicBottoms(on)
    setup(on)
    await clearBoard($)

    const success =
      'Auto mode blocked Bash(echo success). Approve it in /permissions.'
    const failure =
      'Auto mode blocked Bash(echo failure). Approve it in /permissions.'
    const stays =
      'Auto mode blocked Bash(echo stays). Approve it in /permissions.'
    const runner =
      'Auto mode blocked Runner(build). Approve it in /permissions.'

    await denyAction(
      $,
      'deny-success',
      'Bash',
      { command: 'echo success', description: 'Before approval' },
    )
    await denyAction(
      $,
      'deny-failure',
      'Bash',
      { command: 'echo failure', description: 'Before failure' },
    )
    await denyAction(
      $,
      'deny-stays',
      'Bash',
      { command: 'echo stays' },
    )
    await denyAction(
      $,
      'deny-runner',
      'Runner',
      { command: 'build', cwd: '/one' },
    )

    const ui = await $.ui.mount(PANE('dock', 200, 35))

    await finishAction(
      $,
      'run-success',
      'Bash',
      { command: 'echo success', description: 'After approval' },
    )
    await failAction(
      $,
      'run-failure',
      'Bash',
      { command: 'echo failure', description: 'After failure' },
    )
    await finishAction(
      $,
      'run-different',
      'Bash',
      { command: 'echo something else' },
    )

    let tree = await ui.drawn()
    let all = textOf(tree)

    expect(all).not.toContain(success)
    expect(all).not.toContain(failure)
    expect(fromLabel(rowWith(tree, 1, stays), 'Q3')).toBe(
      `Q3 ${stays}`,
    )
    expect(fromLabel(rowWith(tree, 1, runner), 'Q4')).toBe(
      `Q4 ${runner}`,
    )

    await finishAction(
      $,
      'run-different-input',
      'Runner',
      { command: 'build', cwd: '/two' },
    )

    tree = await ui.drawn()
    expect(fromLabel(rowWith(tree, 1, runner), 'Q4')).toBe(
      `Q4 ${runner}`,
    )

    await finishAction(
      $,
      'run-other-tool',
      'OtherRunner',
      { command: 'build', cwd: '/one' },
    )

    tree = await ui.drawn()
    expect(fromLabel(rowWith(tree, 1, runner), 'Q4')).toBe(
      `Q4 ${runner}`,
    )

    await finishAction(
      $,
      'run-identical',
      'Runner',
      { command: 'build', cwd: '/one' },
    )

    all = textOf(await ui.drawn())
    expect(all).not.toContain(runner)
    expect(all).toContain(stays)

    await ui.unmount()
  },
)

test(
  "pressing a blocked entry's answer control removes it",
  async ($: any, on: any) => {
    setupClassicBottoms(on)
    setup(on)
    await clearBoard($)

    const blocked =
      'Auto mode blocked Bash(rm temporary.txt). Approve it in /permissions.'
    await denyAction(
      $,
      'deny-press',
      'Bash',
      { command: 'rm temporary.txt' },
    )

    const ui = await $.ui.mount(PANE('dock', 180, 30))
    let tree = await ui.drawn()
    const button = rowButton(tree, 1, blocked, 'answered-')

    expect(button?.props?.key).toBe('answered-q1')
    expect(button?.props?.label).toBe('○')

    await ui.press({ key: 'answered-q1' })

    tree = await ui.drawn()
    expect(textOf(tree)).not.toContain(blocked)
    expect(textOf(borderedBoxes(tree)[1])).toContain(
      'No open questions.',
    )

    await ui.unmount()
  },
)

test(
  'model-facing question and prompt APIs hide and cannot resolve blocked entries',
  async ($: any, on: any) => {
    setupClassicBottoms(on)
    setup(on)
    await clearBoard($)

    const blocked =
      'Auto mode blocked Bash(make release). Approve it in /permissions.'
    await denyAction(
      $,
      'deny-model-facing',
      'Bash',
      { command: 'make release' },
    )

    const ui = await $.ui.mount(PANE('dock', 200, 30))

    const onlyBlocked = await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: [],
      resolve: [],
    })
    expect(onlyBlocked.result).toBe('No open questions.')

    const onlyBlockedPrompt = await $.prompt.submit({
      text: 'Continue working.',
      context: ['existing context'],
      wait: false,
      origin: { kind: 'composer' },
    })
    expect(onlyBlockedPrompt).toStrictEqual({
      text: 'Continue working.',
      context: ['existing context'],
    })

    const lowerCaseResolve = await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: [],
      resolve: ['q1'],
    })
    expect(lowerCaseResolve.result).toBe('No open questions.')
    expect(
      fromLabel(rowWith(await ui.drawn(), 1, blocked), 'Q1'),
    ).toBe(`Q1 ${blocked}`)

    const upperCaseResolve = await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: [],
      resolve: ['Q1'],
    })
    expect(upperCaseResolve.result).toBe('No open questions.')
    expect(
      fromLabel(rowWith(await ui.drawn(), 1, blocked), 'Q1'),
    ).toBe(`Q1 ${blocked}`)

    const ordinary = await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: ['Which release channel?'],
      resolve: [],
    })
    expect(parseQuestions(ordinary)).toStrictEqual([
      { id: 'Q2', text: 'Which release channel?' },
    ])

    const questionContext = [
      "Open questions on the user's sticky board:",
      '- Q2: Which release channel?',
      'If this message answers any of them, or one no longer matters, resolve it with mcp__sticky-board__questions.',
    ].join('\n')
    const withOrdinary = await $.prompt.submit({
      text: 'Use the stable channel.',
      wait: false,
      origin: { kind: 'composer' },
    })

    expect(withOrdinary).toStrictEqual({
      text: 'Use the stable channel.',
      context: [questionContext],
    })

    await ui.unmount()
  },
)

test(
  'AskUserQuestion answers do not remove identically worded blocked entries',
  async ($: any, on: any) => {
    setupClassicBottoms(on)
    const { controls } = setup(on)
    const blocked =
      'Auto mode blocked Bash(echo locked). Approve it in /permissions.'

    controls.ask = async (_$: any, e: any) => ({
      result: {
        questions: e.questions,
        answers: { [blocked]: 'Approved' },
      },
    })

    await clearBoard($)
    await denyAction(
      $,
      'deny-ask',
      'Bash',
      { command: 'echo locked' },
    )

    await $.tool.call({
      tool: 'AskUserQuestion',
      questions: [questionInput(blocked)],
    })

    const ui = await $.ui.mount(PANE('dock', 200, 30))
    const tree = await ui.drawn()

    expect(boxRows(tree, 1)[0]).toBe(
      ' Open questions  1 · press ○ when answered',
    )
    expect(fromLabel(rowWith(tree, 1, blocked), 'Q1')).toBe(
      `Q1 ${blocked}`,
    )

    await ui.unmount()
  },
)

test(
  'closing-question fallback discounts blocks but still notices explicit questions',
  async ($: any, on: any) => {
    setupClassicBottoms(on)
    setup(on)
    await clearBoard($)

    await $.turn.start({
      text: 'Run the blocked action.',
      turnId: 'turn-block-only',
    })
    await denyAction(
      $,
      'deny-fallback',
      'Bash',
      { command: 'deploy' },
    )
    await $.turn.complete({
      answer: 'The deploy was blocked.\n\nWhich environment should I use?',
      durationMs: 10,
      isAborted: false,
      turnId: 'turn-block-only',
      reason: 'answer',
    })

    expect(await listQuestions($)).toStrictEqual([
      { id: 'Q2', text: 'Which environment should I use?' },
    ])

    await clearBoard($)

    await $.turn.start({
      text: 'Run another blocked action.',
      turnId: 'turn-block-and-question',
    })
    await denyAction(
      $,
      'deny-explicit',
      'Bash',
      { command: 'publish' },
    )
    await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: ['Explicitly tracked question?'],
      resolve: [],
    })
    await $.turn.complete({
      answer: 'The publish was blocked.\n\nFallback must not be added?',
      durationMs: 10,
      isAborted: false,
      turnId: 'turn-block-and-question',
      reason: 'answer',
    })

    expect(await listQuestions($)).toStrictEqual([
      { id: 'Q2', text: 'Explicitly tracked question?' },
    ])
  },
)

test(
  'subagent turn starts do not reset main-turn closing-question bookkeeping',
  async ($: any, on: any) => {
    setup(on)
    await clearBoard($)

    await $.turn.start({
      text: 'Run the main turn.',
      turnId: 'turn-main',
    })
    await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: ['Already tracked in the main turn?'],
      resolve: [],
    })
    await $.turn.start({
      text: 'Do the subagent work.',
      turnId: 'turn-subagent',
      agentId: 'agent-1',
    })
    await $.turn.complete({
      answer: 'Main answer.\n\nThis fallback must not appear?',
      durationMs: 20,
      isAborted: false,
      turnId: 'turn-main',
      reason: 'answer',
    })

    expect(await listQuestions($)).toStrictEqual([
      { id: 'Q1', text: 'Already tracked in the main turn?' },
    ])
  },
)

test(
  'subagent permission blocks are shown on the board',
  async ($: any, on: any) => {
    setupClassicBottoms(on)
    setup(on)
    await clearBoard($)

    const blocked =
      'Auto mode blocked WebFetch(https://example.com). Approve it in /permissions.'
    await denyAction(
      $,
      'deny-subagent',
      'WebFetch',
      { url: 'https://example.com' },
      { agent_id: 'agent-7' },
    )

    const ui = await $.ui.mount(PANE('dock', 200, 30))
    const tree = await ui.drawn()

    expect(boxRows(tree, 1)[0]).toBe(
      ' Open questions  1 · press ○ when answered',
    )
    expect(fromLabel(rowWith(tree, 1, blocked), 'Q1')).toBe(
      `Q1 ${blocked}`,
    )

    await ui.unmount()
  },
)

test(
  'PermissionDenied returns the result from the hook beneath it',
  async ($: any, on: any) => {
    setupClassicBottoms(on, { retry: true })
    setup(on)
    await clearBoard($)

    const result = await denyAction(
      $,
      'deny-passthrough',
      'Bash',
      { command: 'echo retry' },
    )

    expect(result).toStrictEqual({ retry: true })
  },
)

test(
  'clear removes permission blocks and restarts question labels',
  async ($: any, on: any) => {
    setupClassicBottoms(on)
    setup(on)
    await clearBoard($)

    const blocked =
      'Auto mode blocked Bash(echo clear-me). Approve it in /permissions.'
    await denyAction(
      $,
      'deny-before-clear',
      'Bash',
      { command: 'echo clear-me' },
    )

    const ui = await $.ui.mount(PANE('dock', 200, 30))
    let tree = await ui.drawn()

    expect(fromLabel(rowWith(tree, 1, blocked), 'Q1')).toBe(
      `Q1 ${blocked}`,
    )

    await clearBoard($)

    tree = await ui.drawn()
    expect(textOf(tree)).not.toContain(blocked)
    expect(textOf(borderedBoxes(tree)[1])).toContain(
      'No open questions.',
    )

    await denyAction(
      $,
      'deny-after-clear',
      'Bash',
      { command: 'echo clear-me' },
    )

    tree = await ui.drawn()
    expect(fromLabel(rowWith(tree, 1, blocked), 'Q1')).toBe(
      `Q1 ${blocked}`,
    )
    expect(textOf(tree)).not.toContain(`Q2 ${blocked}`)

    await ui.unmount()
  },
)

test(
  'prompt.compose tells the model not to add blocked actions as questions',
  async ($: any, on: any) => {
    setup(on)

    const result = await $.prompt.compose({
      model: 'test-model',
      promptModel: 'test-model',
      surfaces: ['terminal'],
      tools: ['Bash', ...BOARD_TOOLS],
      outputStyle: null,
      traits: [],
    })
    const section = result.sections.find(
      (one: any) => one.id === 'sticky-board:questions',
    )
    const sentence =
      'When auto mode blocks one of your actions, the board shows it to the user by itself: do not add a question for it.'

    expect(section).toBeDefined()
    expect(section?.text).toContain(sentence)
  },
)

test(
  'duplicate blocks count only additions in closing-question bookkeeping',
  async ($: any, on: any) => {
    setupClassicBottoms(on)
    setup(on)
    await clearBoard($)

    await $.turn.start({
      text: 'Track the question and try the action.',
      turnId: 'turn-duplicate-block',
    })
    await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: ['Already tracked in this turn?'],
      resolve: [],
    })
    await denyAction(
      $,
      'deny-duplicate-first',
      'Bash',
      { command: 'deploy duplicate' },
    )
    await denyAction(
      $,
      'deny-duplicate-second',
      'Bash',
      { command: 'deploy duplicate' },
    )
    await $.turn.complete({
      answer: 'The action is still blocked.\n\nThis fallback must not be added?',
      durationMs: 10,
      isAborted: false,
      turnId: 'turn-duplicate-block',
      reason: 'answer',
    })

    expect(await listQuestions($)).toStrictEqual([
      { id: 'Q1', text: 'Already tracked in this turn?' },
    ])
  },
)

test(
  'different non-shell tools with the same input remain separate blocks',
  async ($: any, on: any) => {
    setupClassicBottoms(on)
    setup(on)
    await clearBoard($)

    const first =
      'Auto mode blocked FirstTool. Approve it in /permissions.'
    const second =
      'Auto mode blocked SecondTool. Approve it in /permissions.'

    await denyAction($, 'deny-first-tool', 'FirstTool', {})
    await denyAction($, 'deny-second-tool', 'SecondTool', {})

    const ui = await $.ui.mount(PANE('dock', 180, 30))
    const tree = await ui.drawn()

    expect(boxRows(tree, 1)[0]).toBe(
      ' Open questions  2 · press ○ when answered',
    )
    expect(fromLabel(rowWith(tree, 1, first), 'Q1')).toBe(
      `Q1 ${first}`,
    )
    expect(fromLabel(rowWith(tree, 1, second), 'Q2')).toBe(
      `Q2 ${second}`,
    )

    await ui.unmount()
  },
)

test(
  'shown actions collapse whitespace before applying the character limit',
  async ($: any, on: any) => {
    setupClassicBottoms(on)
    setup(on)
    await clearBoard($)

    const raw = `${'x'.repeat(70)} \t\n   tail-end`
    const normalized = `${'x'.repeat(70)} tail-end`
    const blocked =
      `Auto mode blocked WhitespaceTool(${normalized}). Approve it in /permissions.`

    await denyAction(
      $,
      'deny-whitespace-cut',
      'WhitespaceTool',
      { command: raw },
    )

    const ui = await $.ui.mount(PANE('dock', 240, 30))
    const tree = await ui.drawn()

    expect(
      fromLabel(rowWith(tree, 1, 'WhitespaceTool('), 'Q1'),
    ).toBe(`Q1 ${blocked}`)

    await ui.unmount()
  },
)

test(
  'dismissed question matching a block remains after the action runs',
  async ($: any, on: any) => {
    setupClassicBottoms(on)
    setup(on)
    await clearBoard($)

    const question =
      'Auto mode blocked Bash(echo overlap). Approve it in /permissions.'
    const input = { command: 'echo overlap' }

    await denyAction($, 'deny-overlap', 'Bash', input)
    await $.tool.call({
      tool: 'AskUserQuestion',
      questions: [questionInput(question)],
    })
    await finishAction($, 'run-overlap', 'Bash', input)

    expect(await listQuestions($)).toStrictEqual([
      { id: 'Q2', text: question },
    ])
  },
)
