export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export type Task = { id: string; subject: string; status: TaskStatus; at: number }

export type Question = { id: string; text: string; at: number }

export type Questions = { seq: number; open: Question[] }

// `rowId` is the transcript row a press on the entry scrolls back to.
export type Answer = { rowId: string; question: string; answer: string; at: number }

export type PrStage = 'pre_pr' | 'open' | 'ci' | 'deploy' | 'live'

export type PullRequest = {
  name: string
  number?: number
  stage: PrStage
  isOk: boolean
  status: string
  at: number
}

export type Offsets = { tasks: number; questions: number; answers: number; prs: number }

declare module 'claude-code' {
  interface PluginState {
    'sticky-board': {
      tasks: Task[]
      questions: Questions
      answers: Answer[]
      prs: PullRequest[]
      scroll: Offsets
    }
  }
}
