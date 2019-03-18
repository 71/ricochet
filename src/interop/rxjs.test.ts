import { BehaviorSubject } from 'rxjs'

import { ObservableSymbol } from '..'

describe('RxJS interop', () => {
  it('Considers RxJS observables as observables', () => {
    const subject = new BehaviorSubject(1)

    expect(subject[ObservableSymbol]()).toBe(subject)
  })
})
