import { expect, mock, test } from 'claude-code/testing'

const TASKS_TOOL = 'mcp__sticky-board__tasks'
const QUESTIONS_TOOL = 'mcp__sticky-board__questions'
const ANSWERED_TOOL = 'mcp__sticky-board__answered'
const PRS_TOOL = 'mcp__sticky-board__prs'
const DESIGN_TOOL = 'mcp__sticky-board__design'
const BASE_TIME = 1760300000000

type SetupOptions = {
  sessionId?: string
  entries?: Readonly<Record<string, unknown>>
  now?: number
  failStoreSet?: boolean
}

const setup = (on: any, options: SetupOptions = {}) => {
  const store = new Map<string, unknown>(
    Object.entries(options.entries ?? {}),
  )
  const clock = mock.clock(on, { now: options.now ?? BASE_TIME })
  const controls = {
    sessionId: options.sessionId ?? 'session-1',
    opens: [] as any[],
    toasts: [] as string[],
    endCalls: 0,
    store,
    storeSetAttempts: 0,
    clock,
  }

  on('command.register', async (_$: any, e: any) => ({
    value: { command: e.name },
  }))
  on('tool.register', async (_$: any, e: any) => ({
    value: { tool: `mcp__sticky-board__${e.name}` },
  }))
  on('ui.open', async (_$: any, e: any) => {
    controls.opens.push(e)

    return { value: { isPlaced: true } }
  })
  on('ui.toast', async (_$: any, e: any) => {
    controls.toasts.push(e.text)

    return { value: undefined }
  })
  on('session.id', async () => ({ value: controls.sessionId }))
  on('session.surfaces', async () => ({ value: ['terminal'] }))
  on('session.start', async (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.end', async (_$: any, e: any) => {
    controls.endCalls += 1

    return { sessionId: e.sessionId }
  })
  on('prompt.submit', async (_$: any, e: any) =>
    e.context === undefined
      ? { text: e.text }
      : { text: e.text, context: e.context },
  )

  on('store.get', async (_$: any, e: any) => ({
    value: store.get(e.key),
  }))
  on('store.set', async (_$: any, e: any) => {
    controls.storeSetAttempts += 1

    if (options.failStoreSet === true) {
      throw new Error('The test store is unavailable.')
    }

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

  return controls
}

const setupPermissionDenied = (on: any): void => {
  on('classic.PermissionDenied', async () => ({}))
}

const PANE = (
  placement: 'inline' | 'dock' | 'widget',
  bodyColumns = 100,
  bodyRows = 40,
): any => ({
  plugin: 'sticky-board',
  surface: placement === 'widget' ? 'desktop' : 'terminal',
  component: 'Pane',
  requestId: 'sticky-board',
  props: {
    title: 'Sticky board',
    isFocused: false,
    bodyColumns,
    placement,
    scroll: { offset: 0, bodyRows },
    view: {},
    ...(placement === 'widget'
      ? { anchoredEdges: ['bottom', 'right'] }
      : {}),
  },
})

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

const boxNamed = (tree: any, title: string): any =>
  borderedBoxes(tree).find(box => textOf(box).includes(` ${title} `))

const resetBoard = async ($: any): Promise<void> => {
  await $.session.end({
    reason: 'clear',
    sessionId: 'test-reset',
    resume: {},
  })
}

const startSession = ($: any): Promise<any> =>
  $.session.start({
    cwd: '/tmp/sticky-board-tests',
    surface: 'terminal',
    isInteractive: true,
  })

const endSession = (
  $: any,
  sessionId: string,
  reason: 'clear' | 'resume' | 'other' = 'resume',
): Promise<any> =>
  $.session.end({
    reason,
    sessionId,
    resume: {},
  })

const pin = ($: any, text: string): Promise<any> =>
  $.command.run({
    command: 'sticky',
    args: `note ${text}`,
  })

const scrollBoard = (
  $: any,
  by: number,
  bodyRows: number,
): Promise<any> =>
  $.ui.scroll({
    component: 'Pane',
    requestId: 'sticky-board',
    offset: 0,
    by,
    bodyRows,
    contentRows: 100,
    origin: { kind: 'person' },
  })

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

const savedWithNote = (
  text: string,
  n: number,
  at = BASE_TIME,
): any => ({
  ...emptySavedBoard(at),
  notes: {
    seq: n,
    list: [{ n, text, at }],
  },
})

const storedBoards = (
  store: ReadonlyMap<string, unknown>,
): [string, unknown][] =>
  [...store.entries()].filter(([key]) => key.startsWith('board:'))

test(
  'sticky note command handles usage, ordinary opens, and a pinned note',
  async ($: any, on: any) => {
    // Red if register.tsx changes `if (text === '')` to `if (false)`.
    const controls = setup(on)
    await resetBoard($)

    const empty = await $.command.run({
      command: 'sticky',
      args: 'note   ',
    })
    expect(empty.text).toBeUndefined()
    expect(controls.toasts).toStrictEqual([
      'Type the note after the command: /sticky note <text>',
    ])
    expect(controls.opens).toHaveLength(0)

    const other = await $.command.run({
      command: 'sticky',
      args: 'show',
    })
    expect(other.text).toBe('Sticky board opened.')

    const bare = await $.command.run({ command: 'sticky' })
    expect(bare.text).toBe('Sticky board opened.')

    const added = await $.command.run({
      command: 'sticky',
      args: 'NoTe    spaced\n note',
    })
    expect(added.text).toBeUndefined()
    expect(controls.toasts).toStrictEqual([
      'Type the note after the command: /sticky note <text>',
      'Pinned N1 to the board.',
    ])
    expect(
      controls.opens.map((one: any) => one.id),
    ).toStrictEqual([
      'sticky-board',
      'sticky-board',
      'sticky-board',
    ])

    const ui = await $.ui.mount(PANE('dock'))
    expect(textOf(await ui.drawn())).toContain('N1 spaced note')
    await ui.unmount()
  },
)

test(
  'notes draw newest first in warning boxes, remove by circle without label reuse, and clear away',
  async ($: any, on: any) => {
    // Red if register.tsx deletes the `update($, notes, () => ({ seq: 0, list: [] }))` clear-reset line.
    const controls = setup(on)
    await resetBoard($)

    const emptyDock = await $.ui.mount(PANE('dock'))
    expect(boxNamed(await emptyDock.drawn(), 'Notes')).toBeUndefined()
    await emptyDock.unmount()

    const emptyInline = await $.ui.mount(PANE('inline', 100, 20))
    expect(boxNamed(await emptyInline.drawn(), 'Notes')).toBeUndefined()
    await emptyInline.unmount()

    await pin($, 'older note')
    await pin($, 'newer note')

    const dock = await $.ui.mount(PANE('dock', 100, 40))
    let tree = await dock.drawn()
    let notesBox = boxNamed(tree, 'Notes')
    let notesText = textOf(notesBox)

    expect(notesBox).toMatchObject({
      type: 'Box',
      props: { borderStyle: 'round', borderColor: 'warning' },
    })
    expect(notesText).toContain(' Notes  2 · press ○ to remove')
    expect(notesText.indexOf('N2 newer note')).toBeGreaterThanOrEqual(0)
    expect(notesText.indexOf('N2 newer note')).toBeLessThan(
      notesText.indexOf('N1 older note'),
    )
    expect(await dock.find({ key: 'note-1' })).toMatchObject({
      type: 'Button',
      key: 'note-1',
      props: { label: '○' },
    })

    await dock.press({ key: 'note-2' })
    await pin($, 'replacement note')

    tree = await dock.drawn()
    notesBox = boxNamed(tree, 'Notes')
    notesText = textOf(notesBox)
    expect(notesText).toContain('N3 replacement note')
    expect(notesText).toContain('N1 older note')
    expect(notesText).not.toContain('N2 newer note')
    expect(notesText.indexOf('N3 replacement note')).toBeLessThan(
      notesText.indexOf('N1 older note'),
    )
    expect(controls.toasts.at(-1)).toBe('Pinned N3 to the board.')
    await dock.unmount()

    const inline = await $.ui.mount(PANE('inline', 100, 20))
    expect(boxNamed(await inline.drawn(), 'Notes')).toMatchObject({
      type: 'Box',
      props: { borderColor: 'warning' },
    })
    expect(textOf(await inline.drawn())).toContain('N3 replacement note')
    await inline.unmount()

    await endSession($, 'notes-clear', 'clear')

    const clearedDock = await $.ui.mount(PANE('dock'))
    expect(boxNamed(await clearedDock.drawn(), 'Notes')).toBeUndefined()
    await clearedDock.unmount()

    const clearedInline = await $.ui.mount(PANE('inline', 100, 20))
    expect(boxNamed(await clearedInline.drawn(), 'Notes')).toBeUndefined()
    await clearedInline.unmount()
  },
)

test(
  'notes keep the newest 30 and never reuse an evicted or removed label',
  async ($: any, on: any) => {
    // Red if register.tsx changes `.slice(-KEPT_NOTES)` to `.slice(0, KEPT_NOTES)`.
    const controls = setup(on)
    await resetBoard($)

    for (let index = 1; index <= 31; index += 1) {
      await pin($, `cap note ${index}`)
    }

    const ui = await $.ui.mount(PANE('dock', 100, 100))
    const notesBox = boxNamed(await ui.drawn(), 'Notes')

    expect(textOf(notesBox)).toContain(
      ' Notes  30 · press ○ to remove',
    )
    expect(await ui.find({ key: 'note-1' })).toBeUndefined()
    expect(await ui.find({ key: 'note-2' })).toBeDefined()
    expect(await ui.find({ key: 'note-31' })).toBeDefined()
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(30)

    await ui.press({ key: 'note-31' })
    await pin($, 'after cap removal')

    expect(await ui.find({ key: 'note-31' })).toBeUndefined()
    expect(await ui.find({ key: 'note-32' })).toBeDefined()
    expect(await ui.find({ key: 'note-1' })).toBeUndefined()
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(30)
    expect(controls.toasts.at(-1)).toBe('Pinned N32 to the board.')

    await ui.unmount()
  },
)

test(
  'a person naming a note gets only that note in named-entry context',
  async ($: any, on: any) => {
    // Red if register.tsx removes `N` from the `[TAPDN]` named-label expression.
    setup(on, { sessionId: 'named-note' })
    await resetBoard($)
    await pin($, 'ship the blue build')

    const unnamed = await $.prompt.submit({
      text: 'Keep going without naming it.',
      wait: false,
      origin: { kind: 'composer' },
    })
    expect(unnamed).toStrictEqual({
      text: 'Keep going without naming it.',
    })

    const named = await $.prompt.submit({
      text: 'Use n1, but AN1 and N10 are not that label.',
      wait: false,
      origin: { kind: 'composer' },
    })
    expect(named).toStrictEqual({
      text: 'Use n1, but AN1 and N10 are not that label.',
      context: [
        [
          "Entries on the user's sticky board that this message names:",
          '- N1: the user\'s own note "ship the blue build"',
        ].join('\n'),
      ],
    })
  },
)

test(
  'widget summarizes empty, open, and fully resolved boards without buttons',
  async ($: any, on: any) => {
    // Red if register.tsx changes the empty `glance` result from `Nothing on the board yet.`.
    setup(on)
    await resetBoard($)

    const empty = await $.ui.mount(PANE('widget', 100, 6))
    expect(textOf(await empty.drawn())).toBe(
      'Nothing on the board yet.',
    )
    expect(await empty.findAll({ type: 'Button' })).toHaveLength(0)
    await empty.unmount()

    await $.tool.call({
      tool: TASKS_TOOL,
      tasks: [{ subject: 'Open task', status: 'pending' }],
    })
    await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: ['Open question?'],
      resolve: [],
    })
    await $.tool.call({
      tool: ANSWERED_TOOL,
      question: 'Answered question?',
      answer: 'Answered.',
    })
    await $.tool.call({
      tool: DESIGN_TOOL,
      points: [{ topic: 'Discuss design', state: 'discussing' }],
    })
    await $.tool.call({
      tool: PRS_TOOL,
      name: 'Open pull request',
      stage: 'ci',
      ok: true,
    })
    await pin($, 'open-board note')

    const open = await $.ui.mount(PANE('widget', 100, 6))
    expect(textOf(await open.drawn())).toBe(
      '1 task open · 1 open question · D1 being discussed · 1 note · 1 answered · 1 pull request',
    )
    expect(await open.findAll({ type: 'Button' })).toHaveLength(0)
    await open.unmount()

    await $.tool.call({
      tool: TASKS_TOOL,
      tasks: [{ subject: 'Open task', status: 'completed' }],
    })
    await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: [],
      resolve: ['q1'],
    })
    await $.tool.call({
      tool: DESIGN_TOOL,
      points: [
        {
          topic: 'Discuss design',
          state: 'settled',
          decision: 'Use the settled design.',
        },
      ],
    })
    await $.tool.call({
      tool: PRS_TOOL,
      name: 'Open pull request',
      remove: true,
    })

    const dock = await $.ui.mount(PANE('dock', 100, 60))
    await dock.press({ key: 'note-1' })
    await dock.unmount()

    const resolved = await $.ui.mount(PANE('widget', 100, 6))
    expect(textOf(await resolved.drawn())).toBe(
      'all 1 task done · all 1 design point settled · 1 answered',
    )
    expect(await resolved.findAll({ type: 'Button' })).toHaveLength(0)
    await resolved.unmount()
  },
)

test(
  'drawing a widget does not replace the full pane scroll record',
  async ($: any, on: any) => {
    // Red if register.tsx inserts the one line `drawn.names = []` in the widget branch.
    setup(on)
    await resetBoard($)

    await $.tool.call({
      tool: TASKS_TOOL,
      tasks: Array.from({ length: 8 }, (_, index) => ({
        subject: `Scroll item ${String(index + 1).padStart(2, '0')}`,
        status: 'pending',
      })),
    })

    const full = await $.ui.mount(PANE('inline', 80, 6))
    expect(textOf(await full.drawn())).toContain('Scroll item 01')
    await full.unmount()

    const widget = await $.ui.mount(PANE('widget', 80, 6))
    expect(textOf(await widget.drawn())).toBe('8 tasks open')
    expect(await widget.findAll({ type: 'Button' })).toHaveLength(0)
    await widget.unmount()

    expect(await scrollBoard($, 100, 6)).toStrictEqual({})

    const scrolled = await $.ui.mount(PANE('inline', 80, 6))
    const scrolledText = textOf(await scrolled.drawn())
    expect(scrolledText).toContain('Scroll item 08')
    expect(scrolledText).not.toContain('Scroll item 01')
    expect(await scrolled.find({ key: 'tasks-up' })).toBeDefined()
    await scrolled.unmount()
  },
)

test(
  'session end saves every board box and a fresh state restores counters without label reuse',
  async ($: any, on: any) => {
    // Red if register.tsx changes `update($, notes, () => board.notes)` to restore an empty notes value.
    const controls = setup(on, { sessionId: 'resume-all' })
    await resetBoard($)
    await startSession($)

    await pin($, 'discarded note')
    const notePane = await $.ui.mount(PANE('dock'))
    await notePane.press({ key: 'note-1' })
    await notePane.unmount()
    await pin($, 'kept note')

    await $.tool.call({
      tool: TASKS_TOOL,
      tasks: [{ subject: 'Discarded task', status: 'pending' }],
    })
    await $.tool.call({ tool: TASKS_TOOL, tasks: [] })
    await $.tool.call({
      tool: TASKS_TOOL,
      tasks: [{ subject: 'Kept task', status: 'pending' }],
    })
    await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: ['Kept question?'],
      resolve: [],
    })
    await $.tool.call({
      tool: ANSWERED_TOOL,
      question: 'Kept answered question?',
      answer: 'Kept answer.',
    })
    await $.tool.call({
      tool: PRS_TOOL,
      name: 'Kept pull request',
      stage: 'ci',
      ok: true,
      status: 'Tests running.',
    })
    await $.tool.call({
      tool: DESIGN_TOOL,
      points: [{ topic: 'Kept design', state: 'discussing' }],
    })

    await endSession($, 'resume-all', 'resume')

    const saved = controls.store.get('board:resume-all')
    expect(saved).toMatchObject({
      v: 1,
      at: BASE_TIME,
      tasks: {
        seq: 2,
        list: [
          {
            n: 2,
            subject: 'Kept task',
            status: 'pending',
            at: BASE_TIME,
          },
        ],
      },
      questions: {
        seq: 1,
        open: [
          {
            id: 'q1',
            text: 'Kept question?',
            at: BASE_TIME,
          },
        ],
      },
      answers: {
        seq: 1,
        list: [
          {
            n: 1,
            rowId: expect.any(String),
            question: 'Kept answered question?',
            answer: 'Kept answer.',
            at: BASE_TIME,
          },
        ],
      },
      prs: {
        seq: 1,
        list: [
          {
            n: 1,
            name: 'Kept pull request',
            stage: 'ci',
            isOk: true,
            status: 'Tests running.',
            at: BASE_TIME,
          },
        ],
      },
      design: {
        seq: 1,
        list: [
          {
            n: 1,
            topic: 'Kept design',
            state: 'discussing',
            decision: '',
            at: BASE_TIME,
          },
        ],
      },
      notes: {
        seq: 2,
        list: [
          {
            n: 2,
            text: 'kept note',
            at: BASE_TIME,
          },
        ],
      },
    })
    expect(storedBoards(controls.store)).toStrictEqual([
      ['board:resume-all', saved],
    ])

    const fresh = await $.ui.mount(PANE('widget', 100, 6))
    expect(textOf(await fresh.drawn())).toBe(
      'Nothing on the board yet.',
    )
    await fresh.unmount()

    await startSession($)

    const restored = await $.ui.mount(PANE('widget', 100, 6))
    expect(textOf(await restored.drawn())).toBe(
      '1 task open · 1 open question · D1 being discussed · 1 note · 1 answered · 1 pull request',
    )
    await restored.unmount()

    const tasksAfterRestore = await $.tool.call({
      tool: TASKS_TOOL,
      tasks: [
        { subject: 'Kept task', status: 'pending' },
        { subject: 'After restore', status: 'pending' },
      ],
    })
    expect(tasksAfterRestore.result).toContain('T2 [pending] Kept task')
    expect(tasksAfterRestore.result).toContain(
      'T3 [pending] After restore',
    )
    expect(tasksAfterRestore.result).not.toContain(
      'T1 [pending] After restore',
    )

    await pin($, 'after restore')
    expect(controls.toasts.at(-1)).toBe('Pinned N3 to the board.')
  },
)

test(
  'an emptied board saves a counters-only snapshot that prevents label reuse',
  async ($: any, on: any) => {
    // Red if register.tsx changes the `isUsed` counter check in `snapshot` to always be false.
    const controls = setup(on, { sessionId: 'counters-only' })
    await resetBoard($)
    await startSession($)

    await pin($, 'temporary')
    const pane = await $.ui.mount(PANE('dock'))
    await pane.press({ key: 'note-1' })
    await pane.unmount()

    await endSession($, 'counters-only', 'resume')

    expect(controls.store.get('board:counters-only')).toMatchObject({
      v: 1,
      at: BASE_TIME,
      tasks: { seq: 0, list: [] },
      questions: { seq: 0, open: [] },
      answers: { seq: 0, list: [] },
      prs: { seq: 0, list: [] },
      design: { seq: 0, list: [] },
      notes: { seq: 1, list: [] },
    })

    await startSession($)
    await pin($, 'after empty restore')
    expect(controls.toasts.at(-1)).toBe('Pinned N2 to the board.')
  },
)

test(
  'owner unset or different leaves an ending session stored board untouched',
  async ($: any, on: any) => {
    // Red if register.tsx changes `if (who !== id)` in `saveBoard` to `if (false)`.
    const untouched = { sentinel: 'leave this value alone' }
    const controls = setup(on, {
      sessionId: 'different',
      entries: {
        'board:target': untouched,
      },
    })
    await resetBoard($)

    await endSession($, 'target', 'other')
    expect(storedBoards(controls.store)).toStrictEqual([
      ['board:target', untouched],
    ])

    controls.sessionId = 'different'
    await startSession($)
    await endSession($, 'target', 'other')

    expect(storedBoards(controls.store)).toStrictEqual([
      ['board:target', untouched],
    ])
  },
)

test(
  'a reload with the same owner does not restore entries the person removed',
  async ($: any, on: any) => {
    // Red if register.tsx changes the same-owner early return in `takeOver` to `if (false)`.
    const stored = savedWithNote('remove before reload', 7)
    const controls = setup(on, {
      sessionId: 'reload-session',
      entries: { 'board:reload-session': stored },
    })
    await resetBoard($)
    await startSession($)

    const pane = await $.ui.mount(PANE('dock'))
    expect(textOf(await pane.drawn())).toContain(
      'N7 remove before reload',
    )
    await pane.press({ key: 'note-7' })
    await pane.unmount()

    await startSession($)

    const widget = await $.ui.mount(PANE('widget', 100, 6))
    expect(textOf(await widget.drawn())).toBe(
      'Nothing on the board yet.',
    )
    await widget.unmount()

    expect(
      controls.store.get('board:reload-session'),
    ).toStrictEqual(stored)
  },
)

test(
  'a sticky note after a session id change restores before adding and continues the counter',
  async ($: any, on: any) => {
    // Red if register.tsx replaces the command-run `await takeOver($)` line with `void 0`.
    const controls = setup(on, {
      sessionId: 'before-sticky-resume',
      entries: {
        'board:after-sticky-resume': savedWithNote(
          'restored before command',
          4,
        ),
      },
    })
    await resetBoard($)
    await startSession($)

    controls.sessionId = 'after-sticky-resume'
    const added = await pin($, 'added after command takeover')

    expect(added.text).toBeUndefined()
    expect(controls.toasts.at(-1)).toBe('Pinned N5 to the board.')

    const pane = await $.ui.mount(PANE('dock'))
    const shown = textOf(await pane.drawn())
    expect(shown).toContain('N5 added after command takeover')
    expect(shown).toContain('N4 restored before command')
    expect(shown.indexOf('N5 added after command takeover')).toBeLessThan(
      shown.indexOf('N4 restored before command'),
    )
    await pane.unmount()
  },
)

test(
  'prompt submit after the session id changes restores that conversations board',
  async ($: any, on: any) => {
    // Red if register.tsx replaces the prompt-submit `await takeOver($)` line with `void 0`.
    const controls = setup(on, {
      sessionId: 'first-session',
      entries: {
        'board:second-session': savedWithNote(
          'restored on submit',
          4,
        ),
      },
    })
    await resetBoard($)
    await startSession($)

    controls.sessionId = 'second-session'
    const submitted = await $.prompt.submit({
      text: 'Continue the resumed conversation.',
      wait: false,
      origin: { kind: 'composer' },
    })
    expect(submitted).toStrictEqual({
      text: 'Continue the resumed conversation.',
    })

    const pane = await $.ui.mount(PANE('dock'))
    expect(textOf(await pane.drawn())).toContain(
      'N4 restored on submit',
    )
    await pane.unmount()

    await pin($, 'after changed id')
    expect(controls.toasts.at(-1)).toBe('Pinned N5 to the board.')
  },
)

test(
  'a non-person prompt after a session id change restores the saved board',
  async ($: any, on: any) => {
    // Red if register.tsx makes the prompt-submit takeover line conditional on `e.origin.kind === 'composer'`.
    const controls = setup(on, {
      sessionId: 'before-notification-resume',
      entries: {
        'board:after-notification-resume': savedWithNote(
          'restored for notification',
          6,
        ),
      },
    })
    await resetBoard($)
    await startSession($)

    controls.sessionId = 'after-notification-resume'
    const submitted = await $.prompt.submit({
      text: 'Background task finished.',
      context: ['machine context'],
      wait: false,
      origin: { kind: 'task-notification' },
    })
    expect(submitted).toStrictEqual({
      text: 'Background task finished.',
      context: ['machine context'],
    })

    const pane = await $.ui.mount(PANE('dock'))
    expect(textOf(await pane.drawn())).toContain(
      'N6 restored for notification',
    )
    await pane.unmount()
  },
)

test(
  'blocked questions are omitted from saved boards while their counter is kept',
  async ($: any, on: any) => {
    // Red if register.tsx changes `q.open.filter(one => one.blocked === undefined)` to use `q.open` unchanged.
    setupPermissionDenied(on)
    const controls = setup(on, { sessionId: 'blocked-save' })
    await resetBoard($)
    await startSession($)

    await $.tool.call({
      tool: QUESTIONS_TOOL,
      add: ['Keep this ordinary question?'],
      resolve: [],
    })
    await $.classic.PermissionDenied({
      tool_name: 'Bash',
      tool_input: { command: 'dangerous command' },
      tool_use_id: 'blocked-tool-use',
      reason: 'Auto mode denied this action.',
    })

    await endSession($, 'blocked-save', 'other')

    const saved = controls.store.get('board:blocked-save') as {
      questions: unknown
    }
    expect(saved.questions).toStrictEqual({
      seq: 2,
      open: [
        {
          id: 'q1',
          text: 'Keep this ordinary question?',
          at: BASE_TIME,
          rowId: expect.any(String),
        },
      ],
    })
  },
)

test(
  'malformed saved boards are rejected whole for nested entries, counters, and version',
  async ($: any, on: any) => {
    // Red if register.tsx weakens `isCount` to accept every numeric value.
    const badNested = savedWithNote('must not partially restore', 9)
    badNested.tasks = {
      seq: 1,
      list: [
        {
          id: 'board:0',
          n: 1,
          subject: 'Invalid nested task',
          status: 'not-a-status',
          at: BASE_TIME,
        },
      ],
    }

    const negative = savedWithNote('negative counter note', 1)
    negative.notes = { ...negative.notes, seq: -1 }

    const fractional = savedWithNote('fractional counter note', 2)
    fractional.notes = { ...fractional.notes, seq: 1.5 }

    const wrongVersion = savedWithNote('wrong version note', 3)
    wrongVersion.v = 2

    const controls = setup(on, {
      sessionId: 'bad-nested',
      entries: {
        'board:bad-nested': badNested,
        'board:negative': negative,
        'board:fractional': fractional,
        'board:wrong-version': wrongVersion,
      },
    })
    await resetBoard($)

    for (const id of [
      'bad-nested',
      'negative',
      'fractional',
      'wrong-version',
    ]) {
      controls.sessionId = id
      const submitted = await $.prompt.submit({
        text: `Open ${id}.`,
        wait: false,
        origin: { kind: 'composer' },
      })
      expect(submitted).toStrictEqual({ text: `Open ${id}.` })

      const widget = await $.ui.mount(PANE('widget', 100, 6))
      expect(textOf(await widget.drawn())).toBe(
        'Nothing on the board yet.',
      )
      await widget.unmount()
    }

    await pin($, 'fresh after malformed boards')
    expect(controls.toasts.at(-1)).toBe('Pinned N1 to the board.')
  },
)

test(
  'a saved board whose counter trails an entry label is ignored',
  async ($: any, on: any) => {
    // Red if register.tsx removes `&& labelOf(one) <= seq` from keptBox's `list.every` line.
    const controls = setup(on, {
      sessionId: 'counter-behind-label',
      entries: {
        'board:counter-behind-label': {
          ...emptySavedBoard(),
          notes: {
            seq: 0,
            list: [
              {
                n: 1,
                text: 'must not restore',
                at: BASE_TIME,
              },
            ],
          },
        },
      },
    })
    await resetBoard($)
    await startSession($)

    const widget = await $.ui.mount(PANE('widget', 100, 6))
    expect(textOf(await widget.drawn())).toBe(
      'Nothing on the board yet.',
    )
    await widget.unmount()

    await pin($, 'fresh after rejected counter')
    expect(controls.toasts.at(-1)).toBe('Pinned N1 to the board.')
  },
)

test(
  'the twenty-first saved board prunes the oldest by at and leaves twenty board keys',
  { timeoutMs: 15_000 },
  async ($: any, on: any) => {
    // Red if register.tsx changes `const KEPT_BOARDS = 20` to 21.
    const controls = setup(on, { sessionId: 'board-01' })
    await resetBoard($)

    for (let index = 1; index <= 21; index += 1) {
      const id = `board-${String(index).padStart(2, '0')}`
      controls.sessionId = id
      await startSession($)
      await $.tool.call({
        tool: TASKS_TOOL,
        tasks: [
          {
            subject: `Saved task ${index}`,
            status: 'pending',
          },
        ],
      })
      await endSession($, id, 'resume')

      if (index < 21) {
        await controls.clock.advance(1)
      }
    }

    const boards = storedBoards(controls.store)
    const expectedKeys = Array.from(
      { length: 20 },
      (_, offset) =>
        `board:board-${String(offset + 2).padStart(2, '0')}`,
    )

    expect(boards).toHaveLength(20)
    expect(boards.map(([key]) => key).sort()).toStrictEqual(
      expectedKeys,
    )
    expect(controls.store.get('board:board-01')).toBeUndefined()

    for (let index = 2; index <= 21; index += 1) {
      const id = `board-${String(index).padStart(2, '0')}`
      const at = BASE_TIME + index - 1
      expect(controls.store.get(`board:${id}`)).toMatchObject({
        v: 1,
        at,
        tasks: {
          seq: 1,
          list: [
            {
              id: 'board:0',
              n: 1,
              subject: `Saved task ${index}`,
              status: 'pending',
              at,
            },
          ],
        },
      })
    }
  },
)

test(
  'an unreadable board value is pruned before readable boards',
  async ($: any, on: any) => {
    // Red if register.tsx changes the unreadable-value fallback from `: 0` to `: Number.MAX_SAFE_INTEGER`.
    const entries: Record<string, unknown> = {}

    for (let index = 1; index <= 19; index += 1) {
      const key =
        `board:readable-${String(index).padStart(2, '0')}`
      entries[key] = savedWithNote(
        `readable note ${index}`,
        index,
        BASE_TIME - (20 - index),
      )

      if (index === 5) {
        entries['board:unreadable'] = 'not a readable saved board'
      }
    }

    const controls = setup(on, {
      sessionId: 'new-after-unreadable',
      entries,
    })
    await resetBoard($)
    await startSession($)
    await pin($, 'new board note')
    await endSession($, 'new-after-unreadable', 'other')

    expect(storedBoards(controls.store)).toHaveLength(20)
    expect(controls.store.get('board:unreadable')).toBeUndefined()

    for (let index = 1; index <= 19; index += 1) {
      const key =
        `board:readable-${String(index).padStart(2, '0')}`
      expect(controls.store.get(key)).toStrictEqual(entries[key])
    }

    expect(
      controls.store.get('board:new-after-unreadable'),
    ).toMatchObject({
      v: 1,
      at: BASE_TIME,
      notes: {
        seq: 1,
        list: [
          {
            n: 1,
            text: 'new board note',
            at: BASE_TIME,
          },
        ],
      },
    })
  },
)

test(
  'a never-used empty owned board deletes only its stale stored key',
  async ($: any, on: any) => {
    // Red if register.tsx changes `if (board === undefined || ...)` in `saveBoard` to `if (false)`.
    const pristine = emptySavedBoard(BASE_TIME - 1)
    const other = savedWithNote(
      'another conversation stays',
      3,
      BASE_TIME - 2,
    )
    const unrelated = { sentinel: 'unrelated value stays' }
    const controls = setup(on, {
      sessionId: 'empty-owned',
      entries: {
        'board:empty-owned': pristine,
        'board:other-after-empty': other,
        unrelated,
      },
    })
    await resetBoard($)
    await startSession($)
    await endSession($, 'empty-owned', 'other')

    expect(controls.store.get('board:empty-owned')).toBeUndefined()
    expect(storedBoards(controls.store)).toStrictEqual([
      ['board:other-after-empty', other],
    ])
    expect(controls.store.get('unrelated')).toStrictEqual(unrelated)
  },
)

test(
  'an oversized board deletes only its stored key instead of retaining it',
  { timeoutMs: 10_000 },
  async ($: any, on: any) => {
    // Red if register.tsx changes `const MAX_SAVED = 150_000` to 200_000.
    const other = savedWithNote(
      'another conversation survives',
      4,
      BASE_TIME - 2,
    )
    const unrelated = { sentinel: 'unrelated oversized value stays' }
    const controls = setup(on, {
      sessionId: 'huge-board',
      entries: {
        'board:huge-board': { stale: true },
        'board:other-after-huge': other,
        unrelated,
      },
    })
    await resetBoard($)
    await startSession($)

    await pin($, 'x'.repeat(150_001))
    await endSession($, 'huge-board', 'other')

    expect(controls.store.get('board:huge-board')).toBeUndefined()
    expect(storedBoards(controls.store)).toStrictEqual([
      ['board:other-after-huge', other],
    ])
    expect(controls.store.get('unrelated')).toStrictEqual(unrelated)
  },
)

test(
  'a failing store set still clears state and calls the session-end bottom',
  async ($: any, on: any) => {
    // Red if register.tsx removes `.catch(() => undefined)` from the `saveBoard` call.
    const controls = setup(on, {
      sessionId: 'failing-store',
      failStoreSet: true,
    })

    await resetBoard($)
    await startSession($)
    await pin($, 'before failing clear')

    const endCallsBefore = controls.endCalls
    const ended = await endSession($, 'failing-store', 'clear')

    expect(ended).toStrictEqual({ sessionId: 'failing-store' })
    expect(controls.endCalls).toBe(endCallsBefore + 1)
    expect(controls.storeSetAttempts).toBe(1)

    const widget = await $.ui.mount(PANE('widget', 100, 6))
    expect(textOf(await widget.drawn())).toBe(
      'Nothing on the board yet.',
    )
    await widget.unmount()

    await pin($, 'after failing clear')
    expect(controls.toasts.at(-1)).toBe('Pinned N1 to the board.')
  },
)

test(
  'a changed session id does not restore over a board that already has entries',
  async ($: any, on: any) => {
    // Red if `const board = isEmpty ? keptBoard(...)` uses `true` instead of `isEmpty`.
    const controls = setup(on, {
      sessionId: 'populated-owner',
      entries: {
        'board:changed-session': savedWithNote(
          'stored note must not replace it',
          8,
        ),
      },
    })
    await resetBoard($)
    await startSession($)
    await pin($, 'note already on the board')

    controls.sessionId = 'changed-session'
    await $.prompt.submit({
      text: 'Continue without replacing the current board.',
      wait: false,
      origin: { kind: 'composer' },
    })

    const pane = await $.ui.mount(PANE('dock'))
    const shown = textOf(await pane.drawn())
    expect(shown).toContain('N1 note already on the board')
    expect(shown).not.toContain('N8 stored note must not replace it')
    await pane.unmount()
  },
)

test(
  'a wrong-version board with the newest raw at is pruned before valid boards',
  async ($: any, on: any) => {
    // Red if saveBoard ranks stored values by their raw `at` instead of
    // `keptBoard(value)?.at`.
    const entries: Record<string, unknown> = {
      'board:wrong-version': {
        ...emptySavedBoard(BASE_TIME + 1),
        v: 2,
      },
    }

    for (let index = 1; index <= 19; index += 1) {
      const key =
        `board:valid-${String(index).padStart(2, '0')}`
      entries[key] = savedWithNote(
        `valid note ${index}`,
        index,
        BASE_TIME - (20 - index),
      )
    }

    const controls = setup(on, {
      sessionId: 'new-after-wrong-version',
      entries,
    })
    await resetBoard($)
    await startSession($)
    await pin($, 'new valid board')
    await endSession($, 'new-after-wrong-version', 'other')

    expect(storedBoards(controls.store)).toHaveLength(20)
    expect(
      controls.store.get('board:wrong-version'),
    ).toBeUndefined()

    for (let index = 1; index <= 19; index += 1) {
      const key =
        `board:valid-${String(index).padStart(2, '0')}`
      expect(controls.store.get(key)).toStrictEqual(entries[key])
    }

    expect(
      controls.store.get('board:new-after-wrong-version'),
    ).toMatchObject({
      v: 1,
      at: BASE_TIME,
      notes: {
        seq: 1,
        list: [
          {
            n: 1,
            text: 'new valid board',
            at: BASE_TIME,
          },
        ],
      },
    })
  },
)

test(
  'a failed new-board store set deletes no existing board key',
  async ($: any, on: any) => {
    // Red if `$.store.set(key, board)` moves below the old-board deletions.
    const entries: Record<string, unknown> = {}

    for (let index = 1; index <= 20; index += 1) {
      const key =
        `board:existing-${String(index).padStart(2, '0')}`
      entries[key] = savedWithNote(
        `existing note ${index}`,
        index,
        BASE_TIME - index,
      )
    }

    const controls = setup(on, {
      sessionId: 'failed-new-board',
      entries,
      failStoreSet: true,
    })
    await resetBoard($)
    await startSession($)
    await pin($, 'board whose write fails')
    await endSession($, 'failed-new-board', 'other')

    expect(controls.storeSetAttempts).toBe(1)
    expect(
      controls.store.get('board:failed-new-board'),
    ).toBeUndefined()
    expect(storedBoards(controls.store)).toStrictEqual(
      Object.entries(entries),
    )
  },
)
