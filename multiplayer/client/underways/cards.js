// The Underways' story cards: the dungeon's name as you arrive, and the room's little story as you step into it.
// Pure presentation (DOM, pointer-events off), sized for phones; one card of each kind at a time.
const CSS = `
.uw-cards{position:fixed;inset:0;pointer-events:none;z-index:30;font-family:inherit}
.uw-title{position:absolute;left:50%;top:16%;transform:translate(-50%,-6px);text-align:center;opacity:0;transition:opacity .7s ease,transform .7s ease;width:min(92vw,720px)}
.uw-title.show{opacity:1;transform:translate(-50%,0)}
.uw-title b{display:block;font-size:clamp(22px,4.6vw,44px);letter-spacing:.04em;color:#ffe6b0;text-shadow:0 2px 0 #4a2a10,0 0 24px rgba(255,170,80,.55)}
.uw-title i{display:block;margin-top:6px;font-style:normal;font-size:clamp(13px,2.2vw,18px);color:#f1d9b5;text-shadow:0 1px 2px #000}
.uw-title i:before,.uw-title i:after{content:'';display:inline-block;width:38px;height:1px;background:linear-gradient(90deg,transparent,#e8b46a);vertical-align:middle;margin:0 10px}
.uw-title i:after{transform:scaleX(-1)}
.uw-lore{position:absolute;left:50%;bottom:clamp(110px,19vh,180px);transform:translate(-50%,8px);max-width:min(88vw,560px);padding:12px 18px 13px;border-radius:10px;opacity:0;transition:opacity .5s ease,transform .5s ease;
  background:linear-gradient(180deg,rgba(64,42,24,.92),rgba(40,26,15,.92));border:1px solid rgba(232,180,106,.55);box-shadow:0 6px 24px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,220,160,.18);
  color:#f6e6c8;font-size:clamp(13px,2vw,16px);line-height:1.45;text-align:center}
.uw-lore.show{opacity:1;transform:translate(-50%,0)}
`;
export function createUnderwayCards({mount = null} = {}) {
  const host = mount || (typeof document !== 'undefined' ? document.body : null);
  if (!host) return {title() {}, lore() {}, update() {}, dispose() {}, last: () => null};
  const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
  const root = document.createElement('div'); root.className = 'uw-cards';
  const title = document.createElement('div'); title.className = 'uw-title'; const tb = document.createElement('b'), ti = document.createElement('i'); title.append(tb, ti);
  const lore = document.createElement('div'); lore.className = 'uw-lore'; lore.setAttribute('role', 'status');
  root.append(title, lore); host.append(root);
  let titleLeft = 0, loreLeft = 0, last = null;
  return {
    title(name, sub = '') { tb.textContent = name; ti.textContent = sub; ti.style.display = sub ? '' : 'none'; title.classList.add('show'); titleLeft = 4.2; lore.classList.remove('show'); loreLeft = 0; last = {title: name, sub}; },
    lore(text) { lore.textContent = text; lore.classList.add('show'); loreLeft = Math.min(10, 3.5 + text.length / 22); last = {lore: text}; },
    update(dt) {
      if (titleLeft > 0 && (titleLeft -= dt) <= 0) title.classList.remove('show');
      if (loreLeft > 0 && (loreLeft -= dt) <= 0) lore.classList.remove('show');
    },
    last: () => last,
    dispose() { root.remove(); style.remove(); },
  };
}
