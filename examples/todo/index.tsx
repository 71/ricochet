import { h, observableArray, reactive, Observable, Reactive } from '../../src'


const Todo = ({ done, click = () => null, ...props }: { done: boolean, click?: EventListener, children?: Node }) => (
  <li>
    {props.children}
    <input type='checkbox' checked={done}
           onclick={click}
           oninput={e => done = (e.target as HTMLInputElement).checked} />
  </li>
)

const TodoApp = ({ pageTitle, todos = observableArray([]), text = reactive('') }: { pageTitle: string | Observable<string>, todos?: any[], text?: Reactive<string> }) => {
  let textBox: HTMLInputElement

  return (
    <div>
      <h1>{pageTitle}</h1>

      <input type='text' value={text} ref={x => textBox = x}
             oninput={() => text(textBox.value)} />

      { text.map(txt => txt != '' &&
        <button onclick={() => (todos.push({ text: reactive(txt), done: reactive(false) })) && text('')}>Add todo</button>
      ) }

      <ul class={pageTitle == 'Home' ? 'home-list' : ''}>
        <li>What am I doing here?</li>

        { todos.map(({ text, done }) =>
          <Todo done={done}>{text}</Todo>
        ) }

        <li>What am I doing here again?</li>
      </ul>
    </div>
  )
}


const pageTitle = reactive('Hello world')

document.body.appendChild(<TodoApp pageTitle={pageTitle} />)

setInterval(() => {
  pageTitle('Current time: ' + new Date().toLocaleTimeString())
}, 1000)
