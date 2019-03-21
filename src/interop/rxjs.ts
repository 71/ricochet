import { Observable, Subscription } from 'rxjs'

import { Observable as O, ObservableSymbol } from '..'

declare module 'rxjs' {
  export interface Observable<T> {
    [ObservableSymbol](): Observable<T>
  }
}

/**
 * Converts the given Ricochet `Observable<T>` into an RxJS `Observable<T>`.
 */
export function toObservable<T>(observable: O<T>): Observable<T> {
  const subscribable = observable[ObservableSymbol]()

  return new Observable<T>(s => {
    const subscription = subscribable.subscribe({
      next: s.next.bind(s),
      complete: s.complete.bind(s)
    })

    return new Subscription(subscription.unsubscribe.bind(subscription))
  })
}
