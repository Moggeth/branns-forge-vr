'use strict';
const NORMAL_ORIGIN='http://127.0.0.1:8787';
function localOrigin(value,origin=NORMAL_ORIGIN){try{const url=new URL(value);return url.protocol==='http:'&&url.origin===origin&&url.hostname==='127.0.0.1'&&!url.username&&!url.password;}catch{return false;}}
function voicePage(value,origin=NORMAL_ORIGIN){if(!localOrigin(value,origin))return false;const url=new URL(value);return ['/voice','/voice/'].includes(url.pathname);}
function permissionAllowed({permission,url,origin=NORMAL_ORIGIN,isMainFrame,mediaTypes}){return permission==='media'&&isMainFrame===true&&voicePage(url,origin)&&Array.isArray(mediaTypes)&&mediaTypes.length>0&&mediaTypes.every(type=>type==='audio');}
module.exports={NORMAL_ORIGIN,localOrigin,voicePage,permissionAllowed};
