/* Small keyed renderer for already-escaped, same-origin application markup.
 * Keep mounted cards/buttons alive: a minute ticking is not a new page. */
(function (scope) {
  'use strict';
  const rendered = new WeakMap();
  const key = node => node?.nodeType === 1 ? node.getAttribute('data-live-key') || (node.id ? `id:${node.id}` : null) : null;
  const compatible = (a, b) => a?.nodeType === b?.nodeType && a?.nodeName === b?.nodeName;
  function patch(target, html) {
    if (!target || rendered.get(target) === html) return false;
    const doc = target.ownerDocument;
    if (!doc?.createElement) { if (target.innerHTML !== html) target.innerHTML = html; rendered.set(target, html); return true; }
    const focusRoot = target.getRootNode?.() || doc;
    const active = focusRoot.activeElement;
    const focused = active && target.contains?.(active) ? active : null;
    const template = doc.createElement('template'); template.innerHTML = html;
    const pool = new Map();
    target.querySelectorAll('[data-live-key],[id]').forEach(node => { const value = key(node); if (value) pool.set(value, node); });
    const used = new Set();
    function children(parent, next) {
      let cursor = parent.firstChild;
      for (const desired of Array.from(next.childNodes)) {
        const value = key(desired);
        let current = value ? pool.get(value) : cursor && !key(cursor) ? cursor : null;
        if (used.has(current) || !compatible(current, desired)) current = null;
        if (!current) current = desired.cloneNode(false);
        used.add(current);
        if (current !== cursor) parent.insertBefore(current, cursor);
        if (current.nodeType === 1) {
          // Clipboard feedback belongs to the interaction, not a subsequent score tick.
          const copying = current.hasAttribute('data-text-share') && (current.disabled || current.textContent === '已复制');
          for (const attr of Array.from(current.attributes)) {
            if (!desired.hasAttribute(attr.name) && !(copying && attr.name === 'disabled')) current.removeAttribute(attr.name);
          }
          for (const attr of Array.from(desired.attributes)) if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
          if (!copying) children(current, desired);
        } else if (current.nodeValue !== desired.nodeValue) current.nodeValue = desired.nodeValue;
        cursor = current.nextSibling;
      }
      while (cursor) { const next = cursor.nextSibling; parent.removeChild(cursor); cursor = next; }
    }
    children(target, template.content);
    if (focused?.isConnected && focusRoot.activeElement !== focused) {
      const hidden = focused.closest?.('[hidden]');
      const control = hidden?.id ? [...target.querySelectorAll('[aria-controls]')].find(node => node.getAttribute('aria-controls') === hidden.id) : null;
      (control || (!hidden && focused))?.focus?.({preventScroll:true});
    }
    rendered.set(target, html);
    return true;
  }
  function captureAnchor(root) {
    if (!root?.querySelectorAll || !scope.window) return null;
    // Preserve the first visible card in either column, not an absolute scrollY.
    const viewport = scope.window.innerHeight || 900;
    const candidates = [...root.querySelectorAll('[data-live-key]')].filter(node => {
      if (!node.matches?.('.event-card,.match-item')) return false;
      const box = node.getBoundingClientRect(); return box.bottom > 100 && box.top < viewport;
    }).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return candidates.slice(0,4).map(node => ({node,top:node.getBoundingClientRect().top}));
  }
  function restoreAnchor(anchors) {
    const anchor = anchors?.find(item => item.node.isConnected && !item.node.closest?.('[hidden]') && item.node.getBoundingClientRect().height > 0);
    if (!anchor) return;
    const delta = anchor.node.getBoundingClientRect().top - anchor.top;
    if (Number.isFinite(delta) && Math.abs(delta) > 1) scope.window?.scrollBy?.(0, delta);
  }
  function eventKey(event) {
    // A goal can gain an assist component after initial display. Keep its original
    // keyed card and buttons; new members are a content patch, not a second event.
    return `event:${event.id}`;
  }
  function feedPlan(events, seen = new Set(), pending = new Set(), hold = false) {
    const keys = new Set(events.map(eventKey));
    const nextPending = new Set([...pending].filter(value => keys.has(value)));
    if (hold) for (const event of events) {
      const value = eventKey(event);
      // Late baseline reconstruction is not a just-happened event notification.
      if (!seen.has(value) && !event.baseline) nextPending.add(value);
    }
    else nextPending.clear();
    return { pending: nextPending, visible: events.filter(event => !nextPending.has(eventKey(event))) };
  }
  const api = { patch, captureAnchor, restoreAnchor, eventKey, feedPlan };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else scope.TQLLiveRender = api;
})(typeof window === 'object' ? window : globalThis);
