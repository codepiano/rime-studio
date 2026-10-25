import { createElement, Fragment, type ReactNode, type CSSProperties } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Button, UnstyledButton, TextInput, Textarea, NativeSelect, Checkbox, Radio, Switch, Modal, Drawer, MantineProvider, createTheme } from '@mantine/core';
import './styles';
export { Button, UnstyledButton, TextInput, Textarea, NativeSelect, Checkbox, Radio, Switch, Modal, Drawer };

export const theme = createTheme({
  primaryColor: 'olive', primaryShade: 6, defaultRadius: 6,
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
  colors: { olive: ['#f5f7ef','#e9eedf','#d6dfc9','#bdcda8','#a0b681','#819b5f','#526b3c','#425932','#35482a','#293822'] },
  components: {
    Button: Button.extend({ defaultProps: { size: 'xs', variant: 'default' } }),
    TextInput: TextInput.extend({ defaultProps: { size: 'sm' } }),
    NativeSelect: NativeSelect.extend({ defaultProps: { size: 'sm', rightSectionWidth: 36 } }),
    Checkbox: Checkbox.extend({ defaultProps: { size: 'sm' } }),
    Radio: Radio.extend({ defaultProps: { size: 'sm' } }),
    Switch: Switch.extend({ defaultProps: { size: 'sm' } }),
    Modal: Modal.extend({ defaultProps: { centered: true, overlayProps: { backgroundOpacity: 0.4, blur: 3 }, transitionProps: { duration: 0 } } }),
    Drawer: Drawer.extend({ defaultProps: { position: 'right', size: 700, overlayProps: { backgroundOpacity: 0.4, blur: 3 }, transitionProps: { duration: 0 } } }),
  },
});
const roots = new Map<Element, Root>();
let generation = 0;
function disposeChildren(container: Element) {
  // Capture descendants before unmounting any parent, otherwise nested roots
  // become detached and are no longer discoverable through container.contains.
  const nested = [...roots].filter(([element]) => element !== container && container.contains(element));
  nested.sort(([a], [b]) => a.contains(b) ? 1 : b.contains(a) ? -1 : 0);
  for (const [element, root] of nested) { root.unmount(); roots.delete(element); }
}
function provider(children: ReactNode) { return <MantineProvider theme={theme} forceColorScheme="light">{children}</MantineProvider>; }
const names: Record<string, string> = { class: 'className', for: 'htmlFor', tabindex: 'tabIndex', maxlength: 'maxLength', minlength: 'minLength', readonly: 'readOnly', autocomplete: 'autoComplete', autofocus: 'autoFocus', spellcheck: 'spellCheck', inputmode: 'inputMode', colspan: 'colSpan', rowspan: 'rowSpan', 'stroke-width': 'strokeWidth', 'stroke-linecap': 'strokeLinecap', 'stroke-linejoin': 'strokeLinejoin', viewbox: 'viewBox' };
const booleans = new Set(['disabled','required','readOnly','multiple','hidden','open','autoFocus','checked','selected']);
function attributes(element: Element): Record<string, any> {
  const props: Record<string, any> = {};
  for (const attr of element.attributes) {
    if (/^on/i.test(attr.name)) continue;
    const name = names[attr.name] || attr.name;
    if (name === 'style') {
      const style: Record<string, string> = {};
      const declaration = (element as HTMLElement).style;
      for (const key of declaration) style[key.startsWith('--') ? key : key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = declaration.getPropertyValue(key);
      props.style = style as CSSProperties;
    } else props[name] = booleans.has(name) ? true : attr.value;
  }
  return props;
}
/** Preserve native DOM events, form fields and data selectors used by the existing controllers.
 * Each explicit draw replaces its tree, like the previous template rendering; no DOM observer or monkey patch. */
function convert(node: Node, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (!(node instanceof Element)) return null;
  const tag = node.tagName.toLowerCase(), props = attributes(node);
  props.key = key;
  const children = [...node.childNodes].map(convert);
  if (tag === 'button') {
    if (props.role === 'switch') {
      delete props.role;
      const checked = props['aria-checked'] === 'true'; delete props['aria-checked'];
      props.className = 'studio-switch';
      return <Switch {...props} defaultChecked={checked} />;
    }
    if (node.classList.contains('btn')) return <Button {...props} type={props.type || (node.closest('form') ? 'submit' : 'button')} variant={node.classList.contains('primary') ? 'filled' : 'default'}>{children}</Button>;
    return <UnstyledButton {...props} type={props.type || (node.closest('form') ? 'submit' : 'button')}>{children}</UnstyledButton>;
  }
  if (tag === 'select') {
    const select = node as HTMLSelectElement;
    props.defaultValue = select.multiple ? [...select.selectedOptions].map(x => x.value) : select.value;
    props.classNames = { root: 'studio-field studio-select-field', input: 'studio-select' };
    return <NativeSelect {...props}>{children}</NativeSelect>;
  }
  if (tag === 'option') { delete props.selected; return createElement(tag, props, children); }
  if (tag === 'input' || tag === 'textarea') {
    const type = props.type || 'text';
    if (props.value !== undefined) { props.defaultValue = props.value; delete props.value; }
    if (tag === 'textarea') { props.defaultValue = node.textContent; return <Textarea {...props} classNames={{root: 'studio-field'}} />; }
    if (type === 'checkbox' || type === 'radio') {
      props.defaultChecked = !!props.checked; delete props.checked;
      const Control = type === 'checkbox' ? Checkbox : Radio;
      return <Control {...props} classNames={{root: 'studio-check'}} />;
    }
    if (!['range','hidden','file'].includes(type)) return <TextInput {...props} classNames={{root: 'studio-field'}} />;
    return createElement(tag, props);
  }
  return createElement(tag, props, ...children);
}
export function renderHTML(container: Element, html: string) {
  disposeChildren(container);
  const template = document.createElement('template'); template.innerHTML = html;
  let root = roots.get(container);
  if (!root) { root = createRoot(container); roots.set(container, root); }
  flushSync(() => root.render(provider(<Fragment key={++generation}>{[...template.content.childNodes].map(convert)}</Fragment>)));
}
let overlayRoot: Root | undefined;
let returnFocus: HTMLElement | null = null;
export function closeOverlay() {
  const content = document.getElementById('modal'); if (content) disposeChildren(content);
  if (overlayRoot) flushSync(() => overlayRoot!.render(null));
  if (returnFocus?.isConnected) returnFocus.focus();
  returnFocus = null;
}
export function openOverlay(html: string, className = '', kind: 'modal' | 'drawer' = 'modal') {
  const old = document.getElementById('modal'); if (old) disposeChildren(old);
  if (!old) returnFocus = document.activeElement as HTMLElement;
  overlayRoot ??= createRoot(document.getElementById('overlay-root')!);
  const template = document.createElement('template'); template.innerHTML = html;
  const content = <div key={++generation} id="modal" className={className}>{[...template.content.childNodes].map(convert)}</div>;
  const shared = { opened: true, onClose: closeOverlay, withCloseButton: false, title: template.content.querySelector('#dialog-title')?.textContent || '详情', styles: { header: { display: 'none' } }, classNames: { content: 'studio-overlay', body: 'studio-overlay-body' } };
  flushSync(() => overlayRoot!.render(provider(kind === 'drawer' ? <Drawer {...shared}>{content}</Drawer> : <Modal {...shared} size={className === 'review-dialog' ? 1180 : 700}>{content}</Modal>)));
}
