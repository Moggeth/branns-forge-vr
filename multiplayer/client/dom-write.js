// Write-if-changed DOM helpers. The HUD is refreshed every frame or every snapshot, and the page has body-level
// :has() rules, so even writing the SAME text or attribute makes the browser restyle hundreds of elements and
// re-commit the page. Reading these values is cheap (no layout), so compare first.
export function setText(el, value) { if (!el) return; const v = String(value ?? ''); if (el.textContent !== v) el.textContent = v; }
export function setAttr(el, name, value) { if (!el) return; if (value == null || value === false) { if (el.hasAttribute(name)) el.removeAttribute(name); return; } const v = String(value); if (el.getAttribute(name) !== v) el.setAttribute(name, v); }
export function setHidden(el, hidden) { if (el && el.hidden !== !!hidden) el.hidden = !!hidden; }
export function setData(el, key, value) { if (!el) return; const v = String(value); if (el.dataset[key] !== v) el.dataset[key] = v; }
export function setHTML(el, html) { if (el && el._bfHtml !== html) { el._bfHtml = html; el.innerHTML = html; } }
export function setProp(el, key, value) { if (el && el[key] !== value) el[key] = value; }
