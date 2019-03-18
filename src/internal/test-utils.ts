
/**
 * Returns an HTML element that corresponds to the given HTML string.
 */
export function html(content: TemplateStringsArray) {
  const parent = document.createElement('div')

  parent.innerHTML = content.join()

  return parent.firstElementChild as HTMLElement
}
