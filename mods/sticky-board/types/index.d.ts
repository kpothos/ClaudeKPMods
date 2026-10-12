export type TaskStatus = 'pending' | 'in_progress' | 'completed'

// `n` is the number in an entry's label on the board (T3, A1, P2): given once and never reused,
// so the person can name the entry in a prompt for as long as it is there.
export type Task = { id: string; n: number; subject: string; status: TaskStatus; at: number }

export type Tasks = { seq: number; list: Task[] }

export type Question = { id: string; text: string; at: number }

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

export type Offsets = { tasks: number; questions: number; answers: number; prs: number }

declare module 'claude-code' {
  interface PluginState {
    'sticky-board': {
      tasks: Shaped<Tasks>
      questions: Questions
      answers: Shaped<Answers>
      prs: Shaped<PullRequests>
      scroll: Offsets
    }
  }
}
