import { h, observableArray } from '../../src'

const numbers = observableArray<number>([])

for (let i = 0; i < 10; i++)
  numbers.push(i)

document.body.appendChild(
  <div>
    <p>
      Try adding your own style to the list items; even after modifications,
      the style will remain.
    </p>
    <p>
      You can also access the global 'numbers' variable from the console,
      if you want to play with it.
    </p>
    <button onclick={() => numbers.reverse()}>Reverse</button>
    <button onclick={() => numbers.push(numbers.length)}>Add number</button>
    <button onclick={() => numbers.sort((a, b) => a - b)}>Sort</button>
  </div>
)

document.body.appendChild(
  <ul>
    { numbers.map(i => <li>{i}</li>) }
  </ul>
)

window['numbers'] = numbers
