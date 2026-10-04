// Voice metadata rides the existing authenticated game star, including its relay.
// Audio itself is never sent over this route. The host stamps the real sender.
const vector = v => Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n) && Math.abs(n) <= 10000);
const token = v => typeof v === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(v);
export function validVoiceBody(b) {
  if (!b || !token(b.session)) return false;
  if (b.type === 'state') return typeof b.active === 'boolean' && typeof b.mic === 'boolean' && (!b.active || vector(b.position));
  if (!token(b.targetSession) || !token(b.negotiation)) return false;
  if (b.type === 'offer' || b.type === 'answer') return b.description?.type === b.type && typeof b.description.sdp === 'string' && b.description.sdp.length <= 12000;
  if (b.type === 'ice') return typeof b.candidate?.candidate === 'string' && b.candidate.candidate.length <= 2048;
  return false;
}
export class VoiceRoute {
  constructor(connection, receive) {
    this.connection = connection; this.receive = receive; this.budgets = new Map(); this.outbox = new Map();
    this.handler = ({detail}) => this.incoming(detail);
    connection.addEventListener('message', this.handler);
    // One bounded metadata batch per edge per 100ms leaves the game's 80 message/s
    // budget available for snapshots even with all eight players in voice.
    this.timer = setInterval(() => this.flush(), 100);
  }
  members() { return [...(this.connection.roster?.values() || [])].filter(p => p.online !== false).slice(0, 8); }
  member(id) { return this.members().some(p => p.id === id); }
  send(to, body) {
    const c = this.connection;
    if (!c.peerId || !validVoiceBody(body)) return false;
    const data = {kind:'voice', epoch:c.epoch, to, body};
    if (c.isHost) return this.forward(c.peerId, data);
    return c.send(c.hostId, data);
  }
  forward(from, data) {
    const c = this.connection;
    if (data.to !== '*' && !this.member(data.to)) return false;
    // Only presence/position is broadcast. SDP and ICE are addressed to one peer.
    if (data.to === '*' && data.body.type !== 'state') return false;
    const stamped = {...data, from};
    for (const p of this.members()) if (p.id !== from && (data.to === '*' || data.to === p.id)) {
      if (p.id === c.peerId) this.receive(from, data.body);
      else {
        let queue = this.outbox.get(p.id); if (!queue) { queue = []; this.outbox.set(p.id, queue); }
        if (data.body.type === 'state') { const i = queue.findIndex(m => m.from === from && m.body.type === 'state'); if (i >= 0) queue.splice(i, 1); }
        if (queue.length < 64) queue.push(stamped);
      }
    }
    return true;
  }
  incoming({from, data}) {
    const c = this.connection;
    if (!c.isHost && data?.kind === 'voice_batch' && from === c.hostId && data.epoch === c.epoch && Array.isArray(data.items) && data.items.length <= 64 && JSON.stringify(data).length <= 32000) {
      for (const item of data.items) this.deliver(item);
      return;
    }
    if (data?.kind !== 'voice' || data.epoch !== c.epoch || !this.member(from) || !validVoiceBody(data.body)) return;
    if (JSON.stringify(data).length > 16000) return;
    const now = Date.now();
    let budget = this.budgets.get(from);
    if (!budget || now - budget.at >= 1000) { budget = {at:now, count:0}; this.budgets.set(from, budget); }
    for (const id of this.budgets.keys()) if (!this.member(id)) this.budgets.delete(id);
    if (++budget.count > 60) return;
    if (c.isHost) this.forward(from, data);
    else if (from === c.hostId) this.deliver(data);
  }
  deliver(data) {
    const c = this.connection;
    if (data?.kind === 'voice' && data.epoch === c.epoch && validVoiceBody(data.body) && this.member(data.from) && data.from !== c.peerId && (data.to === '*' || data.to === c.peerId)) this.receive(data.from, data.body);
  }
  flush() {
    const c = this.connection;
    for (const [id, queue] of this.outbox) {
      if (!c.isHost || !this.member(id)) { this.outbox.delete(id); continue; }
      const items = []; let bytes = 100;
      while (queue.length) {
        if (queue[0].epoch !== c.epoch) { queue.shift(); continue; }
        const size = JSON.stringify(queue[0]).length + 1; if (bytes + size > 31000) break;
        items.push(queue.shift()); bytes += size;
      }
      if (items.length) c.send(id, {kind:'voice_batch', epoch:c.epoch, items});
      if (!queue.length) this.outbox.delete(id);
    }
  }
  dispose() { clearInterval(this.timer); this.connection.removeEventListener('message', this.handler); this.budgets.clear(); this.outbox.clear(); }
}
