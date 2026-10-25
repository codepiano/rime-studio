// Explicit bridge for the existing template controllers. The browser entry installs
// the React renderer before loading any views. DOM-less controller tests retain a stub.
export function renderHTML(root, html) {
  if (typeof window !== 'undefined') {
    if (!window.rimeUI) throw new Error('公共控件渲染器尚未初始化');
    window.rimeUI.renderHTML(root, html);
  } else root.innerHTML = html;
}
export const openOverlay = (...args) => window.rimeUI.openOverlay(...args);
export const closeOverlay = () => window.rimeUI.closeOverlay();
