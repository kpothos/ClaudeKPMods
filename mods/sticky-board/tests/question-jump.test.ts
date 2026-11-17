import { expect, mock, test } from 'claude-code/testing'

// Claude Code 2.1.326's test kit cannot answer a mod's own $.ui.scroll call, so pressing
// either question or answer ↑ is not testable here: the press hook is skipped with
// "no implementation for ui.scroll". These tests check stored rowIds and drawn ↑ buttons instead.
const QUESTIONS_TOOL = 'mcp__sticky-board__questions'
const BASE_TIME = 1760300000000

type SetupOptions = {
  askAnswers?: Readonly<Record<string, unknown>>
  entries?: Readonly<Record<string, unknown>>
  sessionId?: string
}

const setup = (on: any, options: SetupOptions = {}) => {
  const store = new Map<string, unknown>(
    Object.entries(options.entries ?? {}),
  )
  const controls = {
    sessionId: options.sessionId ?? 'question-jump-session',
    askToolUseIds: [] as string[],
    store,
  }

  on('tool.call', { tool: 'AskUserQuestion' }, async (_$: any, e: any) => {
    controls.askToolUseIds.push(e.tool_use_id)

    return {
      result: {
        questions: e.questions,
        answers: options.askAnswers ?? {},
      },
    }
  })

  on('turn.start', async (_$: any, e: any) => ({
    turnId: e.turnId,
  }))
  on('turn.complete', async (_$: any, e: any) => ({
    text: e.answer,
  }))
  on('prompt.submit', async (_$: any, e: any) =>
    e.context === undefined
      ? { text: e.text }
      : { text: e.text, context: e.context },
  )
  on('session.end', async (_$: any, e: any) => ({
    sessionId: e.sessionId,
  }))
  on('session.id', async () => ({
    value: controls.sessionId,
  }))

  on('classic.PermissionDenied', async () => ({}))

  on('store.get', async (_$: any, e: any) => ({
    value: store.get(e.key),
  }))
  on('store.set', async (_$: any, e: any) => {
    store.set(e.key, e.value)

    return { value: undefined }
  })
  on('store.delete', async (_$: any, e: any) => {
    store.delete(e.key)

    return { value: undefined }
  })
  on('store.keys', async () => ({
    value: [...store.keys()],
  }))

  mock.clock(on, { now: BASE_TIME })

  return controls
}

const captureQuestionWrites = (on: any): any[] => {
  const writes: any[] = []

  on('state.set', async (_$: any, e: any, next: any) => {
    writes.push(e)

    return next(e)
  })

  return writes
}

const isQuestionsStateEvent = (event: any): boolean =>
  event.plugin === 'sticky-board' && event.key === 'questions'

const questionWrites = (writes: any[]): any[] =>
  writes.filter(isQuestionsStateEvent)

const latestQuestions = (writes: any[]): any => {
  const write = questionWrites(writes).at(-1)

  if (write === undefined) {
    throw new Error('The sticky board made no questions state write.')
  }

  return write.value
}

const PANE = (bodyColumns = 100, bodyRows = 40): any => ({
  plugin: 'sticky-board',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'sticky-board',
  props: {
    title: 'Sticky board',
    isFocused: false,
    bodyColumns,
    placement: 'dock',
    scroll: { offset: 0, bodyRows },
    view: {},
  },
})

const questionInput = (question: string): any => ({
  question,
  header: 'Choice',
  options: [
    { label: 'First', description: 'Use the first choice.' },
    { label: 'Second', description: 'Use the second choice.' },
  ],
  multiSelect: false,
})

const clearBoard = ($: any): Promise<any> =>
  $.session.end({
    reason: 'clear',
    sessionId: 'test-clear',
    resume: {},
  })

const claimBoard = ($: any): Promise<any> =>
  $.prompt.submit({
    text: 'Restore the current board.',
    wait: false,
    origin: { kind: 'task-notification' },
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

const appendResponse = (
  $: any,
  uuid: string,
  content: any[],
  agentId?: string,
): Promise<any> =>
  $.session.append({
    message: {
      type: 'assistant',
      role: 'assistant',
      content,
    },
    door: 'response',
    origin: { kind: 'model', model: 'test-model' },
    uuid,
    ...(agentId === undefined ? {} : { agentId }),
  })

const appendToolResult = (
  $: any,
  uuid: string,
  toolUseId: string,
  tool: string,
  agentId?: string,
): Promise<any> =>
  $.session.append({
    message: {
      type: 'user',
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: 'Test result.',
        },
      ],
    },
    door: 'tool-result',
    origin: { kind: 'tool', tool },
    uuid,
    ...(agentId === undefined ? {} : { agentId }),
  })

const completeTurn = (
  $: any,
  turnId: string,
  answer: string,
): Promise<any> =>
  $.turn.complete({
    answer,
    durationMs: 10,
    isAborted: false,
    turnId,
    reason: 'answer',
  })

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

const rowNodeWith = (
  tree: any,
  boxIndex: number,
  text: string,
): any =>
  boxRowNodes(tree, boxIndex).find(row => textOf(row).includes(text))

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

const emptySavedBoard = (at = BASE_TIME): any => ({
  v: 1,
  at,
  tasks: { seq: 0, list: [] },
  questions: { seq: 0, open: [] },
  answers: { seq: 0, list: [] },
  prs: { seq: 0, list: [] },
  design: { seq: 0, list: [] },
  notes: { seq: 0, list: [] },
})

test(
  'questions tool, AskUserQuestion, and PermissionDenied attach their call row ids',
  async ($: any, on: any) => {
    // Red if register.tsx changes the questions-tool `addTo` argument from `e.tool_use_id` to `undefined`.
    const writes = captureQuestionWrites(on)
    const controls = setup(on, { sessionId: 'source-rows' })
    await clearBoard($)
    await claimBoard($)

    const toolQuestion = 'Question added by the board tool?'
    const askQuestion = 'Question added by AskUserQuestion?'

    await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: [toolQuestion],
      resolve: [],
    })
    await $.tool.call({
      tool: 'AskUserQuestion',
      questions: [questionInput(askQuestion)],
    })
    await denyAction(
      $,
      'permission-denied-row',
      'Bash',
      { command: 'echo blocked' },
    )

    const askRowId = controls.askToolUseIds[0]
    const current = latestQuestions(writes)

    expect(askRowId).toEqual(expect.any(String))
    expect(current).toMatchObject({
      seq: 3,
      open: [
        {
          id: 'q1',
          text: toolQuestion,
          at: BASE_TIME,
          rowId: expect.any(String),
        },
        {
          id: 'q2',
          text: askQuestion,
          at: BASE_TIME,
          rowId: askRowId,
        },
        {
          id: 'q3',
          rowId: 'permission-denied-row',
        },
      ],
    })
    expect(current.open[0].rowId).not.toBe('')

    await $.session.end({
      reason: 'other',
      sessionId: 'source-rows',
      resume: {},
    })

    const saved = controls.store.get('board:source-rows') as any

    expect(saved.questions).toMatchObject({
      seq: 3,
      open: [
        {
          id: 'q1',
          text: toolQuestion,
          at: BASE_TIME,
          rowId: current.open[0].rowId,
        },
        {
          id: 'q2',
          text: askQuestion,
          at: BASE_TIME,
          rowId: askRowId,
        },
      ],
    })

    const ui = await $.ui.mount(PANE())

    expect(
      await ui.find({ type: 'Button', key: 'asked-q1' }),
    ).toMatchObject({
      type: 'Button',
      props: {
        key: 'asked-q1',
        label: '↑',
      },
    })
    expect(
      await ui.find({ type: 'Button', key: 'asked-q2' }),
    ).toMatchObject({
      type: 'Button',
      props: {
        key: 'asked-q2',
        label: '↑',
      },
    })
    expect(
      await ui.find({ type: 'Button', key: 'asked-q3' }),
    ).toMatchObject({
      type: 'Button',
      props: {
        key: 'asked-q3',
        label: '↑',
      },
    })

    await ui.unmount()
  },
)

test(
  'a dismissed AskUserQuestion question moves to its tool-result row',
  async ($: any, on: any) => {
    // Red if register.tsx changes `{ ...one, rowId: e.uuid }` to `{ ...one, rowId: callId }`.
    const writes = captureQuestionWrites(on)
    const controls = setup(on)
    await clearBoard($)

    await $.tool.call({
      tool: 'AskUserQuestion',
      questions: [questionInput('Keep this dismissed question?')],
    })

    const callId = controls.askToolUseIds[0]

    expect(callId).toEqual(expect.any(String))
    expect(latestQuestions(writes)).toMatchObject({
      open: [
        {
          rowId: callId,
        },
      ],
    })

    if (callId === undefined) {
      throw new Error('AskUserQuestion call id is missing.')
    }

    await appendToolResult(
      $,
      'dismissed-question-result-row',
      callId,
      'AskUserQuestion',
    )

    expect(latestQuestions(writes)).toMatchObject({
      open: [
        {
          rowId: 'dismissed-question-result-row',
        },
      ],
    })

    const ui = await $.ui.mount(PANE())

    expect(
      await ui.find({ type: 'Button', key: 'asked-q1' }),
    ).toMatchObject({
      type: 'Button',
      props: {
        key: 'asked-q1',
        label: '↑',
      },
    })

    await ui.unmount()
  },
)

test(
  'an answered AskUserQuestion result row causes no questions write',
  async ($: any, on: any) => {
    // Red if register.tsx changes the result-row match guard to `if (true)`.
    const writes = captureQuestionWrites(on)
    const question = 'Remove this answered question?'
    const controls = setup(on, {
      askAnswers: {
        [question]: 'First',
      },
    })
    await clearBoard($)

    await $.tool.call({
      tool: 'AskUserQuestion',
      questions: [questionInput(question)],
    })

    const callId = controls.askToolUseIds[0]
    const before = latestQuestions(writes)
    const countBeforeResult = questionWrites(writes).length

    expect(callId).toEqual(expect.any(String))
    expect(before).toStrictEqual({
      seq: 1,
      open: [],
    })

    if (callId === undefined) {
      throw new Error('AskUserQuestion call id is missing.')
    }

    await appendToolResult(
      $,
      'answered-question-result-row',
      callId,
      'AskUserQuestion',
    )

    expect(questionWrites(writes)).toHaveLength(countBeforeResult)
    expect(latestQuestions(writes)).toStrictEqual(before)
  },
)

test(
  'unrelated and repeated result rows do not move an awaiting question',
  async ($: any, on: any) => {
    // Red if register.tsx changes `awaitingResult.delete(callId)` to `awaitingResult.has(callId)`.
    let questionReads = 0

    on('state.get', async (_$: any, e: any, next: any) => {
      if (isQuestionsStateEvent(e)) {
        questionReads += 1
      }

      return next(e)
    })

    const writes = captureQuestionWrites(on)
    const controls = setup(on)
    await clearBoard($)

    await $.tool.call({
      tool: 'AskUserQuestion',
      questions: [questionInput('Wait for the matching result?')],
    })

    const callId = controls.askToolUseIds[0]
    const beforeUnrelated = latestQuestions(writes)
    const writesBeforeUnrelated = questionWrites(writes).length

    expect(callId).toEqual(expect.any(String))
    expect(beforeUnrelated).toMatchObject({
      open: [
        {
          rowId: callId,
        },
      ],
    })

    await appendToolResult(
      $,
      'unrelated-result-row',
      'another-tool-call',
      'Bash',
    )

    expect(questionWrites(writes)).toHaveLength(
      writesBeforeUnrelated,
    )
    expect(latestQuestions(writes)).toStrictEqual(
      beforeUnrelated,
    )

    if (callId === undefined) {
      throw new Error('AskUserQuestion call id is missing.')
    }

    await appendToolResult(
      $,
      'first-matching-result-row',
      callId,
      'AskUserQuestion',
    )

    const afterFirst = latestQuestions(writes)

    expect(afterFirst).toMatchObject({
      open: [
        {
          rowId: 'first-matching-result-row',
        },
      ],
    })

    const readsBeforeSecond = questionReads
    const writesBeforeSecond = questionWrites(writes).length

    await appendToolResult(
      $,
      'second-matching-result-row',
      callId,
      'AskUserQuestion',
    )

    expect(questionReads).toBe(readsBeforeSecond)
    expect(questionWrites(writes)).toHaveLength(
      writesBeforeSecond,
    )
    expect(latestQuestions(writes)).toStrictEqual(afterFirst)

    const ui = await $.ui.mount(PANE())

    expect(
      await ui.find({ type: 'Button', key: 'asked-q1' }),
    ).toMatchObject({
      type: 'Button',
      props: {
        key: 'asked-q1',
        label: '↑',
      },
    })

    await ui.unmount()
  },
)

test(
  'a subagent PermissionDenied entry moves to its tool-result row',
  async ($: any, on: any) => {
    // Red if register.tsx adds `e.agentId === undefined &&` to the tool-result condition.
    const writes = captureQuestionWrites(on)
    setup(on)
    await clearBoard($)

    await denyAction(
      $,
      'subagent-denied-call',
      'Bash',
      { command: 'echo denied' },
      { agent_id: 'agent-denied' },
    )

    expect(latestQuestions(writes)).toMatchObject({
      open: [
        {
          rowId: 'subagent-denied-call',
        },
      ],
    })

    await appendToolResult(
      $,
      'subagent-denied-result-row',
      'subagent-denied-call',
      'Bash',
      'agent-denied',
    )

    expect(latestQuestions(writes)).toMatchObject({
      open: [
        {
          rowId: 'subagent-denied-result-row',
        },
      ],
    })

    const ui = await $.ui.mount(PANE())

    expect(
      await ui.find({ type: 'Button', key: 'asked-q1' }),
    ).toMatchObject({
      type: 'Button',
      props: {
        key: 'asked-q1',
        label: '↑',
      },
    })

    await ui.unmount()
  },
)

test(
  'a questions-tool question keeps its call row when its result arrives',
  async ($: any, on: any) => {
    // Red if register.tsx adds `awaitingResult.add(e.tool_use_id)` to the questions-tool hook.
    const writes = captureQuestionWrites(on)
    setup(on)
    await clearBoard($)

    await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: ['Stay on the questions-tool call row?'],
      resolve: [],
    })

    const beforeResult = latestQuestions(writes)
    const callId = beforeResult.open[0]?.rowId
    const writesBeforeResult = questionWrites(writes).length

    expect(callId).toEqual(expect.any(String))
    expect(callId).not.toBe('')

    await appendToolResult(
      $,
      'questions-tool-result-row',
      callId,
      QUESTIONS_TOOL,
    )

    expect(questionWrites(writes)).toHaveLength(
      writesBeforeResult,
    )
    expect(latestQuestions(writes)).toStrictEqual(
      beforeResult,
    )

    const ui = await $.ui.mount(PANE())

    expect(
      await ui.find({ type: 'Button', key: 'asked-q1' }),
    ).toMatchObject({
      type: 'Button',
      props: {
        key: 'asked-q1',
        label: '↑',
      },
    })

    await ui.unmount()
  },
)

test(
  'fallback questions use the later of two main response text rows',
  async ($: any, on: any) => {
    // Red if register.tsx changes `replyRow = e.uuid` to `replyRow ||= e.uuid`.
    const writes = captureQuestionWrites(on)
    setup(on)
    await clearBoard($)

    await $.turn.start({
      text: 'Run the turn.',
      turnId: 'later-text-turn',
    })
    await appendResponse($, 'earlier-text-row', [
      { type: 'text', text: 'Earlier reply text.' },
    ])
    await appendResponse($, 'later-text-row', [
      { type: 'text', text: 'Should the later row win?' },
    ])
    await completeTurn(
      $,
      'later-text-turn',
      'Should the later row win?',
    )

    expect(latestQuestions(writes)).toMatchObject({
      seq: 1,
      open: [
        {
          id: 'q1',
          text: 'Should the later row win?',
          rowId: 'later-text-row',
        },
      ],
    })

    const ui = await $.ui.mount(PANE())

    expect(
      await ui.find({ type: 'Button', key: 'asked-q1' }),
    ).toMatchObject({
      type: 'Button',
      props: {
        key: 'asked-q1',
        label: '↑',
      },
    })

    await ui.unmount()
  },
)

test(
  'fallback questions ignore later attachment and prompt text rows',
  async ($: any, on: any) => {
    // Red if register.tsx deletes the `e.door === 'response' &&` line from the `session.append` condition.
    const writes = captureQuestionWrites(on)
    setup(on)
    await clearBoard($)

    await $.turn.start({
      text: 'Run the turn.',
      turnId: 'other-door-text-turn',
    })
    await appendResponse($, 'reply-text-row', [
      { type: 'text', text: 'Should the reply row win?' },
    ])
    await $.session.append({
      message: {
        type: 'user',
        role: 'user',
        content: [
          { type: 'text', text: 'System reminder attachment.' },
        ],
      },
      door: 'attachment',
      origin: { kind: 'engine' },
      uuid: 'attachment-text-row',
    })
    await $.session.append({
      message: {
        type: 'user',
        role: 'user',
        content: [{ type: 'text', text: 'Original prompt text.' }],
      },
      door: 'prompt',
      origin: { kind: 'composer' },
      uuid: 'prompt-text-row',
    })
    await completeTurn(
      $,
      'other-door-text-turn',
      'Should the reply row win?',
    )

    expect(latestQuestions(writes)).toMatchObject({
      seq: 1,
      open: [
        {
          id: 'q1',
          text: 'Should the reply row win?',
          rowId: 'reply-text-row',
        },
      ],
    })
  },
)

test(
  'thinking, tool-use, blank text, and subagent response rows do not become fallback row ids',
  async ($: any, on: any) => {
    // Red if register.tsx changes the `session.append` content predicate to `.some(() => true)`.
    const writes = captureQuestionWrites(on)
    setup(on)
    await clearBoard($)

    const cases: {
      name: string
      content: any[]
      agentId?: string
    }[] = [
      {
        name: 'thinking-only',
        content: [
          {
            type: 'thinking',
            thinking: 'Private reasoning.',
            signature: 'test-signature',
          },
        ],
      },
      {
        name: 'tool-use-only',
        content: [
          {
            type: 'tool_use',
            id: 'tool-use-block',
            name: 'Bash',
            input: { command: 'true' },
          },
        ],
      },
      {
        name: 'blank-text',
        content: [{ type: 'text', text: ' \n\t ' }],
      },
      {
        name: 'subagent-text',
        content: [{ type: 'text', text: 'Subagent reply text.' }],
        agentId: 'agent-rows',
      },
    ]

    const ui = await $.ui.mount(PANE())

    for (const [index, one] of cases.entries()) {
      const n = index + 1
      const turnId = `invalid-row-turn-${n}`
      const question = `Should ${one.name} stay unlinked?`

      await $.turn.start({
        text: `Run ${one.name}.`,
        turnId,
      })
      await appendResponse(
        $,
        `invalid-row-${n}`,
        one.content,
        one.agentId,
      )
      await completeTurn(
        $,
        turnId,
        question,
      )

      const current = latestQuestions(writes)

      expect(current.open).toHaveLength(1)
      expect(current.open[0]).toMatchObject({
        id: `q${n}`,
        text: question,
      })
      expect(
        Object.hasOwn(current.open[0], 'rowId'),
      ).toBe(false)
      expect(
        await ui.find({ type: 'Button', key: `asked-q${n}` }),
      ).toBeUndefined()
      expect(
        await ui.find({ type: 'Button', key: `answered-q${n}` }),
      ).toMatchObject({
        type: 'Button',
        props: {
          key: `answered-q${n}`,
          label: '○',
        },
      })

      await ui.press({ key: `answered-q${n}` })
    }

    await ui.unmount()
  },
)

test(
  'a subagent turn start leaves the main fallback response row in place',
  async ($: any, on: any) => {
    // Red if register.tsx changes the subagent guard in `turn.start` from `return next(e)` to fall through.
    const writes = captureQuestionWrites(on)
    setup(on)
    await clearBoard($)

    await $.turn.start({
      text: 'Run the main turn.',
      turnId: 'main-with-subagent',
    })
    await appendResponse($, 'main-text-before-subagent', [
      { type: 'text', text: 'Main reply text.' },
    ])
    await $.turn.start({
      text: 'Run the subagent.',
      turnId: 'nested-subagent-turn',
      agentId: 'agent-1',
    })
    await completeTurn(
      $,
      'main-with-subagent',
      'Should the main row remain?',
    )

    expect(latestQuestions(writes)).toMatchObject({
      open: [
        {
          text: 'Should the main row remain?',
          rowId: 'main-text-before-subagent',
        },
      ],
    })

    const ui = await $.ui.mount(PANE())

    expect(
      await ui.find({ type: 'Button', key: 'asked-q1' }),
    ).toMatchObject({
      type: 'Button',
      props: {
        key: 'asked-q1',
        label: '↑',
      },
    })

    await ui.unmount()
  },
)

test(
  'a main turn start clears the previous fallback response row',
  async ($: any, on: any) => {
    // Red if register.tsx removes the `replyRow = ''` line from the main `turn.start` hook.
    const writes = captureQuestionWrites(on)
    setup(on)
    await clearBoard($)

    await $.turn.start({
      text: 'Run the first turn.',
      turnId: 'first-main-turn',
    })
    await appendResponse($, 'stale-main-text-row', [
      { type: 'text', text: 'The first turn is complete.' },
    ])
    await completeTurn(
      $,
      'first-main-turn',
      'The first turn is complete.',
    )

    await $.turn.start({
      text: 'Run the second turn.',
      turnId: 'second-main-turn',
    })
    await completeTurn(
      $,
      'second-main-turn',
      'Should this have no jump row?',
    )

    const current = latestQuestions(writes)

    expect(current.open).toHaveLength(1)
    expect(current.open[0]).toMatchObject({
      id: 'q1',
      text: 'Should this have no jump row?',
    })
    expect(Object.hasOwn(current.open[0], 'rowId')).toBe(false)

    const ui = await $.ui.mount(PANE())

    expect(
      await ui.find({ type: 'Button', key: 'asked-q1' }),
    ).toBeUndefined()
    expect(
      await ui.find({ type: 'Button', key: 'answered-q1' }),
    ).toMatchObject({
      type: 'Button',
      props: {
        key: 'answered-q1',
        label: '○',
      },
    })

    await ui.unmount()
  },
)

test(
  'a re-asked ordinary question keeps its label and replaces its row id',
  async ($: any, on: any) => {
    // Red if register.tsx changes the re-ask map body to `(isAsked(one) ? one : one)`.
    const writes = captureQuestionWrites(on)
    setup(on)
    await clearBoard($)

    const question = 'Should this question be asked again?'

    await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: [question],
      resolve: [],
    })

    const first = latestQuestions(writes)
    const firstRowId = first.open[0]?.rowId

    expect(first).toMatchObject({
      seq: 1,
      open: [
        {
          id: 'q1',
          text: question,
          rowId: expect.any(String),
        },
      ],
    })
    expect(firstRowId).not.toBe('')

    await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: [question],
      resolve: [],
    })

    const second = latestQuestions(writes)
    const secondRowId = second.open[0]?.rowId

    expect(second).toMatchObject({
      seq: 1,
      open: [
        {
          id: 'q1',
          text: question,
          rowId: expect.any(String),
        },
      ],
    })
    expect(secondRowId).not.toBe('')
    expect(secondRowId).not.toBe(firstRowId)
    expect(await listQuestions($)).toStrictEqual([
      { id: 'Q1', text: question },
    ])

    const ui = await $.ui.mount(PANE())

    expect(
      await ui.find({ type: 'Button', key: 'asked-q1' }),
    ).toMatchObject({
      type: 'Button',
      props: {
        key: 'asked-q1',
        label: '↑',
      },
    })
    expect(
      await ui.find({ type: 'Button', key: 'asked-q2' }),
    ).toBeUndefined()

    await ui.unmount()
  },
)

test(
  'a blocked same-text entry is not treated as the re-asked ordinary question',
  async ($: any, on: any) => {
    // Red if register.tsx removes `one.blocked === undefined &&` from `isAsked`.
    const writes = captureQuestionWrites(on)
    setup(on)
    await clearBoard($)

    const text =
      'Auto mode blocked Bash(echo overlap). Approve it in /permissions.'

    await denyAction(
      $,
      'blocked-original-row',
      'Bash',
      { command: 'echo overlap' },
    )
    await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: [text],
      resolve: [],
    })

    const beforeReask = latestQuestions(writes)
    const blockedBefore = beforeReask.open.find(
      (one: any) => one.id === 'q1',
    )
    const ordinaryBefore = beforeReask.open.find(
      (one: any) => one.id === 'q2',
    )
    const firstOrdinaryRow = ordinaryBefore?.rowId

    expect(blockedBefore).toMatchObject({
      id: 'q1',
      rowId: 'blocked-original-row',
    })
    expect(ordinaryBefore).toMatchObject({
      id: 'q2',
      text,
      rowId: expect.any(String),
    })
    expect(firstOrdinaryRow).not.toBe('')

    await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: [text],
      resolve: [],
    })

    const afterReask = latestQuestions(writes)
    const blockedAfter = afterReask.open.find(
      (one: any) => one.id === 'q1',
    )
    const ordinaryAfter = afterReask.open.find(
      (one: any) => one.id === 'q2',
    )

    expect(blockedAfter).toMatchObject({
      id: 'q1',
      rowId: 'blocked-original-row',
    })
    expect(ordinaryAfter).toMatchObject({
      id: 'q2',
      text,
      rowId: expect.any(String),
    })
    expect(ordinaryAfter?.rowId).not.toBe(firstOrdinaryRow)
    expect(await listQuestions($)).toStrictEqual([
      { id: 'Q2', text },
    ])

    const ui = await $.ui.mount(PANE())

    expect(
      await ui.find({ type: 'Button', key: 'asked-q1' }),
    ).toMatchObject({
      type: 'Button',
      props: {
        key: 'asked-q1',
        label: '↑',
      },
    })
    expect(
      await ui.find({ type: 'Button', key: 'asked-q2' }),
    ).toMatchObject({
      type: 'Button',
      props: {
        key: 'asked-q2',
        label: '↑',
      },
    })
    expect(
      await ui.find({ type: 'Button', key: 'asked-q3' }),
    ).toBeUndefined()

    await ui.unmount()
  },
)

test(
  'saved questions restore string row ids and tolerate omitted row ids',
  async ($: any, on: any) => {
    // Red if register.tsx changes the row-id validator to require `one.rowId === undefined`.
    const writes = captureQuestionWrites(on)
    const board = emptySavedBoard()
    board.questions = {
      seq: 2,
      open: [
        {
          id: 'q1',
          text: 'Saved question with a row?',
          at: BASE_TIME,
          rowId: 'saved-question-row',
        },
        {
          id: 'q2',
          text: 'Saved question without a row?',
          at: BASE_TIME,
        },
      ],
    }

    setup(on, {
      sessionId: 'saved-row-ids',
      entries: {
        'board:saved-row-ids': board,
      },
    })
    await clearBoard($)
    await claimBoard($)

    expect(latestQuestions(writes)).toStrictEqual(
      board.questions,
    )

    const ui = await $.ui.mount(PANE())
    const tree = await ui.drawn()

    expect(textOf(tree)).toContain('Saved question with a row?')
    expect(textOf(tree)).toContain('Saved question without a row?')
    expect(
      await ui.find({ type: 'Button', key: 'asked-q1' }),
    ).toMatchObject({
      type: 'Button',
      props: {
        key: 'asked-q1',
        label: '↑',
      },
    })
    expect(
      await ui.find({ type: 'Button', key: 'asked-q2' }),
    ).toBeUndefined()
    expect(
      await ui.find({ type: 'Button', key: 'answered-q2' }),
    ).toMatchObject({
      type: 'Button',
      props: {
        key: 'answered-q2',
        label: '○',
      },
    })

    await ui.unmount()
  },
)

test(
  'a saved question with a non-string row id rejects the whole board',
  async ($: any, on: any) => {
    // Red if register.tsx changes `typeof one.rowId === 'string'` to `true`.
    const writes = captureQuestionWrites(on)
    const board = emptySavedBoard()
    board.questions = {
      seq: 1,
      open: [
        {
          id: 'q1',
          text: 'Invalid saved question?',
          at: BASE_TIME,
          rowId: 17,
        },
      ],
    }
    board.notes = {
      seq: 1,
      list: [
        {
          n: 1,
          text: 'This valid sibling must not restore.',
          at: BASE_TIME,
        },
      ],
    }

    setup(on, {
      sessionId: 'invalid-row-id',
      entries: {
        'board:invalid-row-id': board,
      },
    })
    await clearBoard($)
    await claimBoard($)

    expect(latestQuestions(writes)).toStrictEqual({
      seq: 0,
      open: [],
    })

    const ui = await $.ui.mount(PANE())
    const shown = textOf(await ui.drawn())

    expect(shown).toContain('No open questions.')
    expect(shown).not.toContain('Invalid saved question?')
    expect(shown).not.toContain(
      'This valid sibling must not restore.',
    )

    await ui.unmount()
  },
)

test(
  'question rows reserve the jump column and align wrapped continuations',
  async ($: any, on: any) => {
    // Red if register.tsx changes the question wrap width from `textColumns - 2` to `textColumns`.
    const writes = captureQuestionWrites(on)
    setup(on)
    await clearBoard($)

    await $.tool.call({
      tool: 'AskUserQuestion',
      questions: [
        questionInput('Ask now ABCDEFGHIJKLMNOPQ?'),
      ],
    })

    await $.turn.start({
      text: 'Finish the turn.',
      turnId: 'layout-fallback-turn',
    })
    await completeTurn(
      $,
      'layout-fallback-turn',
      'Ask too abcdefghijklmnopq?',
    )

    const current = latestQuestions(writes)

    expect(current).toMatchObject({
      seq: 2,
      open: [
        {
          id: 'q1',
          text: 'Ask now ABCDEFGHIJKLMNOPQ?',
          rowId: expect.any(String),
        },
        {
          id: 'q2',
          text: 'Ask too abcdefghijklmnopq?',
        },
      ],
    })
    expect(current.open).toHaveLength(2)
    expect(
      Object.hasOwn(current.open[1], 'rowId'),
    ).toBe(false)

    const ui = await $.ui.mount(PANE(24, 40))
    const tree = await ui.drawn()
    const rows = boxRows(tree, 1)
    const stamp = timeAt(BASE_TIME)

    expect(rows[0]).toBe(
      ' Open questions  2 · ○ answered · ↑ scroll back',
    )
    expect(
      rows.find(row => row.includes('Q1 Ask now')),
    ).toBe(`${stamp} ○ ↑ Q1 Ask now`)
    expect(
      rows.find(row => row.includes('ABCDEFGHIJ')),
    ).toBe(`${' '.repeat(10)}ABCDEFGHIJ`)
    expect(
      rows.find(row => row.includes('KLMNOPQ?')),
    ).toBe(`${' '.repeat(10)}KLMNOPQ?`)

    expect(
      rows.find(row => row.includes('Q2 Ask too')),
    ).toBe(`${stamp} ○   Q2 Ask too`)
    expect(
      rows.find(row => row.includes('abcdefghij')),
    ).toBe(`${' '.repeat(10)}abcdefghij`)
    expect(
      rows.find(row => row.includes('klmnopq?')),
    ).toBe(`${' '.repeat(10)}klmnopq?`)

    expect(
      rowButton(tree, 1, 'Q1 Ask now', 'asked-'),
    ).toMatchObject({
      type: 'Button',
      props: {
        key: 'asked-q1',
        label: '↑',
      },
    })
    expect(
      rowButton(tree, 1, 'Q2 Ask too', 'asked-'),
    ).toBeUndefined()
    expect(
      (rowNodeWith(tree, 1, 'ABCDEFGHIJ')?.children ?? []).filter(
        (child: any) => child?.type === 'Button',
      ),
    ).toHaveLength(0)
    expect(
      (rowNodeWith(tree, 1, 'abcdefghij')?.children ?? []).filter(
        (child: any) => child?.type === 'Button',
      ),
    ).toHaveLength(0)

    await ui.unmount()
  },
)
