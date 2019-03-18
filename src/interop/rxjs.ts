import { ObservableSymbol } from '..'

// @ts-ignore
declare module 'rxjs' {
  export interface Observable<T> {
    [ObservableSymbol](): Observable<T>
  }
}
