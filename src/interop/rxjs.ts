import * as Rx from 'rxjs'

import { Observable, ObservableSymbol } from '..'

declare module 'rxjs' {
  export interface Observable<T> {
    [ObservableSymbol](): Observable<T>
  }
}

/**
 * Converts the given Ricochet `Observable<T>` into an RxJS `Observable<T>`.
 */
export function toObservable<T>(observable: Observable<T>): Rx.Observable<T> {
  const subscribable = observable[ObservableSymbol]()

  return new Rx.Observable<T>(s => {
    const subscription = subscribable.subscribe({
      next: s.next.bind(s),
      complete: s.complete.bind(s)
    })

    return new Rx.Subscription(subscription.unsubscribe.bind(subscription))
  })
}
