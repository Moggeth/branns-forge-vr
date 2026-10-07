// Requires Python OpenCV for independent QR decoding, plus the standard browser QA environment.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {launch,BASE,here,shot} from './browser-acceptance-lib.mjs';
const a=await launch(),b=await launch({touch:true,viewport:{width:390,height:844}});
try {
  await a.page.route('**/peer/rooms*',r=>r.fulfill({json:{rooms:[]}}));
  await a.page.goto(BASE+'/?acceptanceProbe');
  await a.page.waitForFunction(()=>window.brannHarness);
  if(await a.page.locator('.pn-close').isVisible())await a.page.locator('.pn-close').click();
  await a.page.fill('#name','QR QA');await a.page.click('#create');
  await a.page.waitForFunction(()=>window.brannHarness.state().connected,null,{timeout:30000});
  await a.page.click('#showInviteQr');
  await a.page.locator('#inviteQrImage').waitFor({state:'visible'});
  const src=await a.page.locator('#inviteQrImage').getAttribute('src');
  const file=join(here,'room-qr.png');writeFileSync(file,Buffer.from(src.split(',')[1],'base64'));
  const decoded=execFileSync('python',['-c','import cv2,sys; print(cv2.QRCodeDetector().detectAndDecode(cv2.imread(sys.argv[1]))[0])',file],{encoding:'utf8'}).trim();
  const room=await a.page.evaluate(()=>window.brannHarness.snapshot().room);
  assert.equal(decoded,BASE+'/?room='+room);
  await shot(a.page,'qr-desktop');
  await b.page.goto(decoded);await b.page.waitForFunction(()=>window.brannHarness);
  if(await b.page.locator('.pn-close').isVisible())await b.page.locator('.pn-close').click();
  assert.equal(await b.page.inputValue('#room'),room);
  await b.page.fill('#name','QR Guest');await b.page.click('#join');
  await b.page.waitForFunction(()=>window.brannHarness.snapshot()?.players.length===2,null,{timeout:30000});
  // Exercise the same existing menu path on phones without relying on HUD layout.
  await b.page.locator('[data-touch-action="menu"]').first().click();
  await b.page.locator('#inviteQr summary').click();
  await b.page.locator('#inviteQrImage').waitFor({state:'visible'});
  const box=await b.page.locator('#inviteQrImage').boundingBox();assert.ok(box.width>=200&&box.x>=0&&box.x+box.width<=390&&box.y>=0&&box.y+box.height<=844);
  await shot(b.page,'qr-phone');
  console.log('PASS: QR independently decoded, correct invite room, phone guest joined, responsive QR');
} finally {await a.browser.close();await b.browser.close();}

