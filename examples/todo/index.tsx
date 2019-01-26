const Todo = ({ done, click = () => null, ...props }: { done: boolean, click?: EventListener, children?: Node }) => (
  <li>
    {props.children}
    <input type='checkbox' checked={done}
           onclick={click}
           oninput={e => done = (e.target as HTMLInputElement).checked} />
  </li>
)

const TodoApp = ({ pageTitle, todos = [], text = '' }: { pageTitle: string, todos?: any[], text?: string }) => {
  let textBox: HTMLInputElement

  return (
    <div>
      <h1>{pageTitle}</h1>

      <input type='text' value={text} ref={textBox}
             oninput={() => text = textBox.value} />

      { text != '' &&
        <button onclick={() => (todos.push({ text, done: false })) && (text = '')}>Add todo</button>
      }

      <ul class={pageTitle == 'Home' ? 'home-list' : ''}>
        <li>What am I doing here?</li>

        { todos.map(({ text, done }) => (
          <Todo done={done}>{text}</Todo>
        )) }

        <li>What am I doing here again?</li>
      </ul>
    </div>
  )
}


// @ts-ignore
const pageTitle = new runtime.Observable('Hello world')

document.body.appendChild(<TodoApp pageTitle={pageTitle} />)

setInterval(() => {
  pageTitle.value = 'Current time: ' + new Date().toLocaleTimeString()
}, 1000)
