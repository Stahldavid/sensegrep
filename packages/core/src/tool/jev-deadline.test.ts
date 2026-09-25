import {describe,it,expect} from 'vitest'
import {jevDeadline} from './jev-deadline.js'
describe('Jev stage reservations',()=>{
  it('prevents initial judging and repair from consuming final verification time',()=>{
    let now=0
    const budget=jevDeadline(8000,()=>now)
    expect(budget.allocation).toEqual({totalMs:8000,initialMs:4100,recoveryMs:2400,verificationMs:1500})
    now=4100
    expect(budget.initial()).toBe(0)
    expect(budget.repair()).toBe(2400)
    now=6500
    expect(budget.repair()).toBe(0)
    expect(budget.remaining()).toBe(1500)
    now=8500
    expect(budget.remaining()).toBe(0)
    expect(budget.preliminary()).toBe(0)
  })
  it('never returns negative allocations for tiny explicit deadlines',()=>{
    const budget=jevDeadline(1,()=>0)
    expect(budget.initial()).toBe(1)
    expect(budget.preliminary()).toBe(0)
  })
})
