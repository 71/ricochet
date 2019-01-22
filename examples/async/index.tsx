import { async, Async } from '../../src/runtime/async'


/**
 * Returns a promise that resolves after `n` milliseconds.
 */
function wait(n: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, n))
}


/**
 * A component that takes properties synchronously, and asynchronously returns
 * an element.
 */
const FirstAsyncMessage = async(({ message, timeout }: { message: string, timeout: number }) => (
  wait(timeout).then(() => (
    <h1>{message}</h1>
  ))
))

/**
 * Ditto, but with a different syntax.
 */
const SecondAsyncMessage = ({ onFriday, onOtherDay }: { onFriday: string, onOtherDay: string }) => async(
  wait(2000).then(() => {
    const day = new Date().getDay()

    if (day == 5)
      return <b>{onFriday}</b>
    else
      return <i>{onOtherDay}</i>
  })
)

/**
 * A promise that resolves to a component, used with the `<Async />` component.
 */
const ThirdAsyncMessage = wait(3000).then(() => ({ message }: { message: string }) => (
  <p>{message}</p>
))

/**
 * A component whose properties will be resolved asynchronously,
 * used with the `<Async />` component.
 */
const FourthAsyncMessage = ({ message, bold }: { message: string, bold: boolean }) => (
  bold ? <b>{message}</b> : <p>{message}</p>
)

document.body.appendChild(
  <div>
    <FirstAsyncMessage timeout={1000} message='I am an async component!' />
    <SecondAsyncMessage onFriday='It is Friday!' onOtherDay='It is not Friday...' />
    <Async component={ThirdAsyncMessage} message='I am also an async component!' />
    <Async component={FourthAsyncMessage} props={wait(4000).then(() => ({ message: 'And so am I!' }))} bold={true} />
  </div>
)
