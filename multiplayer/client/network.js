// Versioned, reconnectable client. Credentials remain session-local and never in URLs.
export class RoomConnection extends EventTarget {
  constructor(url) {
    super();
    this.url = url; this.socket = null; this.identity = null;
    this.sequence = 0; this.generation = 0; this.retry = 0; this.closed = true;
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, {detail})); }
  connect({room = '', name = 'Adventurer', role = 'hero', token = ''} = {}) {
    this.close(); this.closed = false;
    this.identity = {room, name, role, token}; this.sequence = 0;
    this.open();
  }
  open() {
    if (this.closed) return;
    const generation = ++this.generation;
    this.emit('status', {state: this.retry ? 'reconnecting' : 'connecting'});
    let socket;
    try { socket = this.socket = new WebSocket(this.url); }
    catch { this.closed = true; this.emit('error', {code:'invalid_endpoint',message:'The game server address is not configured correctly.'}); return; }
    this.joined = false;
    clearTimeout(this.handshakeTimer);
    this.handshakeTimer = setTimeout(() => {
      if (generation === this.generation && !this.joined) socket.close(4000, 'Join timed out');
    }, 12000);
    socket.addEventListener('open', () => {
      if (generation !== this.generation) return socket.close();
      const {room, name, role, token} = this.identity;
      socket.send(JSON.stringify(room ? {type:'join',room,name,role,...(token ? {token} : {})} : {type:'create',name,role}));
    });
    socket.addEventListener('message', ({data}) => {
      if (generation !== this.generation || typeof data !== 'string' || data.length > 262144) return;
      let message; try { message = JSON.parse(data); } catch { return; }
      if (message.type === 'welcome') {
        this.joined = true; clearTimeout(this.handshakeTimer);
        this.retry = 0; this.sequence = Number(message.nextSeq || 1) - 1;
        Object.assign(this.identity, {room: message.room, token: message.token, playerId: message.playerId});
        this.emit('welcome', message); this.emit('status', {state:'connected'});
        if (message.snapshot) this.emit('snapshot', message.snapshot);
      } else if (message.type === 'state') {
        const self = message.snapshot?.players?.find(p => p.id === this.identity.playerId);
        if (self) this.identity.role = self.role;
        this.emit('snapshot', message.snapshot);
      }
      else if (message.type === 'error') {
        if (!this.joined && ['invalid_token','room_not_found','room_full','server_full','invalid_role'].includes(message.code)) {
          if (message.code === 'invalid_token') this.identity.token = '';
          this.close();
          this.emit('status', {state:'disconnected'});
        }
        this.emit('error', message);
      }
      else this.emit(message.type || 'unknown', message);
    });
    socket.addEventListener('error', () => { if (generation === this.generation) this.emit('status', {state:'unreachable'}); });
    socket.addEventListener('close', ({code}) => {
      if (this.closed || generation !== this.generation) return;
      clearTimeout(this.handshakeTimer); this.joined = false;
      if ([4001,1008,1009].includes(code)) {
        this.closed = true;
        this.emit('status', {state:'disconnected'});
        this.emit('error', {code:code === 4001 ? 'session_replaced' : 'connection_rejected', message:code === 4001 ? 'This player rejoined in another window. Join again as a new player here.' : 'Connection rejected. Join again to retry.'});
        return;
      }
      this.emit('status', {state:'reconnecting'});
      if (!this.identity?.token) { this.closed = true; this.emit('status', {state:'disconnected'}); return; }
      this.timer = setTimeout(() => this.open(), Math.min(10000, 500 * 2 ** Math.min(this.retry++, 5)));
    });
  }
  send(type, payload = {}) {
    if (this.socket?.readyState !== WebSocket.OPEN || !this.identity?.token || !this.joined) return false;
    const message = {type, ...payload};
    if (['input', 'action', 'cast'].includes(type)) message.seq = ++this.sequence;
    this.socket.send(JSON.stringify(message)); return true;
  }
  role(role) { return this.send('role', {role}); }
  close() {
    this.closed = true; this.joined = false; ++this.generation; clearTimeout(this.timer); clearTimeout(this.handshakeTimer);
    this.socket?.close(); this.socket = null;
  }
}
