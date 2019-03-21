import { BehaviorSubject, isObservable } from 'rxjs'

import { toObservable }     from './rxjs'
import { ObservableSymbol } from '..'
import { subject }          from '../reactive'

describe('RxJS interop', () => {
  it('Considers RxJS observables as observables', () => {
    const subject = new BehaviorSubject(1)

    expect(subject[ObservableSymbol]()).toBe(subject)
  })

  it('Can convert observables to RxJS observables', () => {
    const s = subject(1)

    expect(isObservable(s)).toBe(false)

    const t = toObservable(s)

    expect(isObservable(t)).toBe(true)
  })
})
