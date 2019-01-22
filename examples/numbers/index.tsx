import { Observable, observable } from '../../src/runtime'
import { map }                    from '../../src/runtime/map'

const numbers: Observable<number[]> = new Observable([])

for (let i = 0; i < 10; i++)
  numbers.value.push(i)

// @ts-ignore
const nums: number[] = numbers

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
    <button onclick={() => nums.reverse()}>Reverse</button>
    <button onclick={() => nums.push(nums.length)}>Add number</button>
    <button onclick={() => nums.sort((a, b) => a - b)}>Sort</button>
  </div>
)

document.body.appendChild(
  <ul>
    { (parent: HTMLUListElement) => map(parent, numbers, i => <li>{observable(i).value + 1}</li>) }
  </ul>
)

window['numbers'] = numbers
