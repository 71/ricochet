import { h, Observable }                     from '../../src'
import { observableArray, ObservableArray }  from '../../src/array'
import { subject, ExtendedSubject, Subject } from '../../src/reactive'


interface TodoProps extends JSX.IntrinsicAttributes {
  click?: EventListener
  done  : Subject<boolean>
}

const Todo = ({ done, click = () => null, ...props }: TodoProps) => (
  <li>
    {props.children}
    <input type='checkbox' checked={done}
           onclick={click}
           oninput={e => done.next((e.target as HTMLInputElement).checked)} />
  </li>
)


interface TodoAppProps {
  pageTitle: string | Observable<string>
  text    ?: ExtendedSubject<string>
  todos   ?: ObservableArray<{ done: Subject<boolean>, text: string }>
}

const TodoApp = ({ pageTitle, todos = observableArray(), text = subject('') }: TodoAppProps) => {
  let textBox: HTMLInputElement

  return (
    <div>
      <h1>{pageTitle}</h1>

      <input type='text' value={text} ref={x => textBox = x}
             oninput={() => text.next(textBox.value)} />

      { text.map(txt => txt != '' &&
        <button onclick={() => (todos.push({ text: txt, done: subject(false) })) && text.next('')}>Add todo</button>
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


const pageTitle = subject('Hello world')

document.body.appendChild(<TodoApp pageTitle={pageTitle} />)

setInterval(() => {
  pageTitle.next('Current time: ' + new Date().toLocaleTimeString())
}, 1000)
