export type TaskStatus = 'pending' | 'in_progress' | 'completed'

// `n` is the number in an entry's label on the board (T3, A1, P2): given once and never reused,
// so the person can name the entry in a prompt for as long as it is there.
export type Task = { id: string; n: number; subject: string; status: TaskStatus; at: number }

export type Tasks = { seq: number; list: Task[] }

// `blocked` marks an action auto mode refused, which the person approves in /permissions; `key`
// tells that action apart from others of its tool, as the engine's own list of refusals does.
export type Question = {
  id: string
  text: string
  at: number
  blocked?: { tool: string; key: string }
}

export type Questions = { seq: number; open: Question[] }

// `rowId` is the transcript row a press on the entry scrolls back to.
export type Answer = { n: number; rowId: string; question: string; answer: string; at: number }

export type Answers = { seq: number; list: Answer[] }

export type PrStage = 'pre_pr' | 'open' | 'ci' | 'deploy' | 'live'

export type PullRequest = {
  n: number
  name: string
  number?: number
  stage: PrStage
  isOk: boolean
  status: string
  at: number
}

export type PullRequests = { seq: number; list: PullRequest[] }

export type DesignState = 'unsettled' | 'discussing' | 'settled'

// `decision` is empty until the point is settled.
export type DesignPoint = {
  n: number
  topic: string
  state: DesignState
  decision: string
  at: number
}

export type DesignPoints = { seq: number; list: DesignPoint[] }

// The pull requests are drawn in the band above the prompt, which the engine scrolls.
export type Offsets = { tasks: number; questions: number; answers: number; design: number }

declare module 'claude-code' {
  interface PluginState {
    'sticky-board': {
      tasks: Shaped<Tasks>
      questions: Questions
      answers: Shaped<Answers>
      prs: Shaped<PullRequests>
      design: Shaped<DesignPoints>
      scroll: Offsets
    }
  }
}
