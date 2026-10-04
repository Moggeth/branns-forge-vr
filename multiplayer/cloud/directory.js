import {DurableObject} from 'cloudflare:workers';
import {DIRECTORY_TTL} from './room-directory.js';

// Only the Worker/room bindings can write; the public endpoint is read-only.
export class ForgeDirectory extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url), now = Date.now();
    if (url.pathname === '/update' && request.method === 'POST') {
      const {code,listing} = await request.json();
      if (!/^\d{8}$/.test(code)) return new Response('Invalid code',{status:400});
      if (listing) await this.ctx.storage.put('room:'+code,listing);
      else await this.ctx.storage.delete('room:'+code);
      if (!await this.ctx.storage.getAlarm()) await this.ctx.storage.setAlarm(now + DIRECTORY_TTL);
      return new Response(null,{status:204});
    }
    if (url.pathname !== '/list') return new Response('Not found',{status:404});
    const cursor=url.searchParams.get('cursor') || '';
    const entries=await this.ctx.storage.list({prefix:'room:',limit:51,...(cursor?{startAfter:cursor}:{})});
    const scanned=[...entries.entries()], page=scanned.slice(0,50);
    const rooms=page.filter(([,v])=>v.expiresAt>now).map(([,v])=>{const {expiresAt,...row}=v;return row;});
    return Response.json({rooms,nextCursor:scanned.length>50?page.at(-1)[0]:null,updatedAt:now});
  }
  async alarm() {
    const now=Date.now(); let cursor, live=false;
    do {
      const entries=await this.ctx.storage.list({prefix:'room:',limit:500,...(cursor?{startAfter:cursor}:{})});
      const expired=[];
      for(const [key,value] of entries) {if(value.expiresAt<=now)expired.push(key);else live=true;cursor=key;}
      if(expired.length)await this.ctx.storage.delete(expired);
      if(entries.size<500)break;
    } while(cursor);
    if(live)await this.ctx.storage.setAlarm(now+DIRECTORY_TTL);
  }
}
