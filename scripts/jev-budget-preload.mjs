import {installBudgetFetch} from './jev-budget.mjs'
if(!process.env.SENSEGREP_RESEARCH_BUDGET) throw Error('Budget ledger required')
globalThis.fetch=installBudgetFetch(process.env.SENSEGREP_RESEARCH_BUDGET)
