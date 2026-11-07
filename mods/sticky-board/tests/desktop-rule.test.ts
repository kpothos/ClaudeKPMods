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
const BASE_SECTIONS = [
  { id: 'intro', text: 'Base prompt.', scope: 'shared' },
]
const LATE_RULE_START =
  "The user's sticky board is now on screen, but this conversation's instructions were set before it was. These instructions about the board hold from now on:\n\n# Sticky board"
const OPEN_QUESTION_NOTE = [
  "Open questions on the user's sticky board:",
  '- Q1: Which database?',
  'If this message answers any of them, or one no longer matters, resolve it with mcp__sticky-board__questions.',
].join('\n')

const setup = (on: any) => {
  const controls: any = {
    surfaces: [],
    dropNext: undefined,
    droppedContext: undefined,
  }

  on('prompt.submit', async (_$: any, e: any) => {
    if (controls.dropNext !== undefined) {
      const drop = controls.dropNext
      controls.dropNext = undefined
      controls.droppedContext = e.context

      return { drop }
    }

    return e.context === undefined
      ? { text: e.text }
      : { text: e.text, context: e.context }
  })

  on('prompt.compose', async () => ({ sections: BASE_SECTIONS }))

  on('session.end', async (_$: any, e: any) => ({
    sessionId: e.sessionId,
  }))

  on('session.surfaces', async () => ({
    value: controls.surfaces,
  }))

  mock.clock(on, { now: BASE_TIME })

  return controls
}

const clearSession = (
  $: any,
  sessionId = 'test-clear',
): Promise<any> =>
  $.session.end({
    reason: 'clear',
    sessionId,
    resume: {},
  })

const compose = (
  $: any,
  surfaces: readonly string[],
): Promise<any> =>
  $.prompt.compose({
    model: 'test-model',
    promptModel: 'test-model',
    surfaces,
    tools: [...BOARD_TOOLS],
    outputStyle: null,
    traits: [],
  })

const composeWithoutTool = (
  $: any,
  surfaces: readonly string[],
  missing: string,
): Promise<any> =>
  $.prompt.compose({
    model: 'test-model',
    promptModel: 'test-model',
    surfaces,
    tools: BOARD_TOOLS.filter(tool => tool !== missing),
    outputStyle: null,
    traits: [],
  })

const submit = (
  $: any,
  text: string,
  origin: any = { kind: 'composer' },
  context?: readonly string[],
): Promise<any> =>
  $.prompt.submit({
    text,
    ...(context === undefined ? {} : { context }),
    wait: false,
    origin,
  })

const expectLateRule = (value: any): void => {
  expect(value).toContain(LATE_RULE_START)

  for (const tool of BOARD_TOOLS) {
    expect(value).toContain(tool)
  }

  for (const label of ['T3', 'Q2', 'A1', 'D2', 'P1']) {
    expect(value).toContain(label)
  }
}

test(
  'a surface appearing after the first compose adds the late rule to one person message',
  async ($: any, on: any) => {
    const controls = setup(on)
    await clearSession($)

    expect(await compose($, [])).toStrictEqual({
      sections: BASE_SECTIONS,
    })

    controls.surfaces = ['desktop']

    const first = await submit(
      $,
      'First message after the desktop attached.',
      { kind: 'bridge' },
      ['existing context'],
    )

    expect(first.text).toBe(
      'First message after the desktop attached.',
    )
    expect(first.context).toHaveLength(2)
    expect(first.context[0]).toBe('existing context')
    expectLateRule(first.context[1])

    const second = await submit(
      $,
      'Second message after the desktop attached.',
      { kind: 'bridge' },
    )

    expect(second).toStrictEqual({
      text: 'Second message after the desktop attached.',
    })
  },
)

test(
  'a later surfaced compose preserves the late rule owed by a headless first compose',
  async ($: any, on: any) => {
    const controls = setup(on)
    await clearSession($)

    expect(await compose($, [])).toStrictEqual({
      sections: BASE_SECTIONS,
    })

    controls.surfaces = ['desktop']

    const recomposed = await compose($, ['desktop'])

    expect(recomposed.sections).toHaveLength(2)
    expect(recomposed.sections[1]).toMatchObject({
      id: 'sticky-board:questions',
      scope: 'session',
    })

    const person = await submit(
      $,
      'The desktop attached during the first turn.',
      { kind: 'bridge' },
    )

    expect(person.text).toBe(
      'The desktop attached during the first turn.',
    )
    expect(person.context).toHaveLength(1)
    expectLateRule(person.context[0])
  },
)

test(
  'a rule sent by the first compose never becomes a late rule as surfaces change',
  async ($: any, on: any) => {
    const controls = setup(on)
    await clearSession($)

    const composed = await compose($, ['desktop'])

    expect(composed.sections).toHaveLength(2)
    expect(composed.sections[1]).toMatchObject({
      id: 'sticky-board:questions',
      scope: 'session',
    })
    expect(composed.sections[1].text).toContain('# Sticky board')

    controls.surfaces = ['desktop']
    expect(
      await submit($, 'Message while desktop is attached.'),
    ).toStrictEqual({
      text: 'Message while desktop is attached.',
    })

    controls.surfaces = []
    expect(
      await submit($, 'Message while no surface is attached.'),
    ).toStrictEqual({
      text: 'Message while no surface is attached.',
    })

    controls.surfaces = ['mobile']
    expect(
      await submit($, 'Message after a different surface attached.'),
    ).toStrictEqual({
      text: 'Message after a different surface attached.',
    })
  },
)

test(
  'a later headless compose preserves a rule sent by the surfaced first compose',
  async ($: any, on: any) => {
    const controls = setup(on)
    await clearSession($)

    const composed = await compose($, ['desktop'])

    expect(composed.sections).toHaveLength(2)
    expect(composed.sections[1]).toMatchObject({
      id: 'sticky-board:questions',
      scope: 'session',
    })

    controls.surfaces = []

    expect(await compose($, [])).toStrictEqual({
      sections: BASE_SECTIONS,
    })

    controls.surfaces = ['desktop']

    expect(
      await submit($, 'The desktop returned after another compose.'),
    ).toStrictEqual({
      text: 'The desktop returned after another compose.',
    })
  },
)

test(
  'a session that remains headless never receives the late rule',
  async ($: any, on: any) => {
    const controls = setup(on)
    await clearSession($)

    await compose($, [])
    controls.surfaces = []

    for (const text of [
      'First headless message.',
      'Second headless message.',
    ]) {
      expect(
        await submit($, text, { kind: 'sdk' }),
      ).toStrictEqual({ text })
    }
  },
)

test(
  'a non-person message neither receives nor consumes the late rule',
  async ($: any, on: any) => {
    const controls = setup(on)
    await clearSession($)

    await compose($, [])
    controls.surfaces = ['desktop']

    const notification = await submit(
      $,
      'Background work completed.',
      { kind: 'task-notification' },
      ['machine context'],
    )

    expect(notification).toStrictEqual({
      text: 'Background work completed.',
      context: ['machine context'],
    })

    const person = await submit(
      $,
      'Continue after the notification.',
    )

    expect(person.context).toHaveLength(1)
    expectLateRule(person.context[0])
  },
)

test(
  'session.end clear lets the next first compose decide the rule state again',
  async ($: any, on: any) => {
    const controls = setup(on)
    await clearSession($)

    await compose($, ['desktop'])
    controls.surfaces = ['desktop']

    expect(
      await submit($, 'The first conversation has its system rule.'),
    ).toStrictEqual({
      text: 'The first conversation has its system rule.',
    })

    expect(
      await clearSession($, 'clear-between-conversations'),
    ).toStrictEqual({
      sessionId: 'clear-between-conversations',
    })

    expect(await compose($, [])).toStrictEqual({
      sections: BASE_SECTIONS,
    })

    controls.surfaces = ['desktop']
    const afterClear = await submit(
      $,
      'The new conversation attached late.',
    )

    expect(afterClear.context).toHaveLength(1)
    expectLateRule(afterClear.context[0])
  },
)

test(
  'the late rule and open-question note share the person message context',
  async ($: any, on: any) => {
    const controls = setup(on)
    await clearSession($)

    await compose($, [])

    expect(
      await $.tool.call({
        tool: QUESTIONS_TOOL,
        add: ['Which database?'],
        resolve: [],
      }),
    ).toStrictEqual({
      result: 'Q1: Which database?',
    })

    controls.surfaces = ['desktop']

    const result = await submit(
      $,
      'SQLite should be fine.',
      { kind: 'composer' },
      ['existing context'],
    )

    expect(result.context).toHaveLength(3)
    expect(result.context[0]).toBe('existing context')
    expectLateRule(result.context[1])
    expect(result.context[2]).toBe(OPEN_QUESTION_NOTE)
  },
)

test(
  'a surfaced first compose missing one board tool never creates a late rule',
  async ($: any, on: any) => {
    const controls = setup(on)
    await clearSession($)

    expect(
      await composeWithoutTool(
        $,
        ['desktop'],
        QUESTIONS_TOOL,
      ),
    ).toStrictEqual({
      sections: BASE_SECTIONS,
    })

    for (const [surfaces, text] of [
      [['desktop'], 'Message on the original surface.'],
      [[], 'Message after the surface detached.'],
      [['mobile'], 'Message after a different surface attached.'],
    ] as const) {
      controls.surfaces = surfaces

      expect(await submit($, text)).toStrictEqual({ text })
    }
  },
)

test(
  'a headless first compose missing one board tool never creates a late rule',
  async ($: any, on: any) => {
    const controls = setup(on)
    await clearSession($)

    expect(
      await composeWithoutTool(
        $,
        [],
        QUESTIONS_TOOL,
      ),
    ).toStrictEqual({
      sections: BASE_SECTIONS,
    })

    for (const [surfaces, text] of [
      [[], 'Message while still headless.'],
      [['desktop'], 'Message after a surface attached.'],
      [[], 'Message after that surface detached.'],
      [['mobile'], 'Message after another surface attached.'],
    ] as const) {
      controls.surfaces = surfaces

      expect(await submit($, text)).toStrictEqual({ text })
    }
  },
)

test(
  'a dropped person message gives the late rule to the next person message only',
  async ($: any, on: any) => {
    const controls = setup(on)
    await clearSession($)

    await compose($, [])
    controls.surfaces = ['desktop']
    controls.dropNext = 'Dropped by a hook beneath.'

    expect(
      await submit(
        $,
        'This message will be dropped.',
        { kind: 'bridge' },
        ['dropped context'],
      ),
    ).toStrictEqual({
      drop: 'Dropped by a hook beneath.',
    })

    expect(controls.droppedContext).toHaveLength(2)
    expect(controls.droppedContext[0]).toBe('dropped context')
    expectLateRule(controls.droppedContext[1])

    const next = await submit(
      $,
      'This message should carry the returned rule.',
      { kind: 'bridge' },
      ['retry context'],
    )

    expect(next.text).toBe(
      'This message should carry the returned rule.',
    )
    expect(next.context).toHaveLength(2)
    expect(next.context[0]).toBe('retry context')
    expectLateRule(next.context[1])

    expect(
      await submit(
        $,
        'This message comes after the rule entered.',
        { kind: 'bridge' },
      ),
    ).toStrictEqual({
      text: 'This message comes after the rule entered.',
    })
  },
)
