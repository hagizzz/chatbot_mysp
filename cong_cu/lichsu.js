require("dotenv").config();
const P=require("../loi/pancake/page_registry");
const C=(()=>{try{return require("../loi/pancake/conversation_tags");}catch(_){return null;}})();
const id=process.argv[2]||"1468690110033030_28717798144485839";
const HOLD=[183,184,185,166,177];   // 184 vào danh sách 25/08/2026 — xem HOLD_TAG_IDS trong bot_worker_api_v3.js
const HINT={183:"AI - CHO XL",184:"AI- XL anh",185:"AI- DON UU TIEN",166:"Hang doi",177:"Dang hoan"};
function ft(v){if(!v)return"";try{const n=Number(v);const d=new Date(isNaN(n)?v:n*(String(v).length<=10?1000:1));return isNaN(d)?String(v):d.toLocaleString("vi-VN");}catch(_){return String(v);}}
(async()=>{try{
await P.init();
const pid=P.pageIdFromConv(i.map(i=>i+"="+NM(i)+(HOLD.includes(i)?" [GIU]":"")).join(" | "):"(khong con the nao)");
console.log("");
console.log("=== LICH SU THE (ke ca da go) ===");
const h=Array.isArray(co.tag_histories)?co.tag_histories:(Array.isArray(co.tag_history)?co.tag_history:[]);
if(!h.length){console.log("(API khong tra tag_histories cho page nay)");}
else{
 h.slice().sort((a,b)=>String(a.inserted_at||a.created_at||a.updated_at||"").localeCompare(String(b.inserted_at||b.created_at||b.updated_at||"")))
 .forEach(x=>{const tid=Number(x.tag_id!=null?x.tag_id:(x.tag&&x.tag.id));
  const rm=(x.removed===true||x.is_.map(i=>i+"="+NM(i)+(HOLD.includes(i)?" [GIU]":"")).join(" | "):"(khong con the nao)");
console.log("");
console.log("=== LICH SU THE (ke ca da go) ===");
const h=Array.isArray(co.tag_histories)?co.tag_histories:(Array.isArray(co.tag_history)?co.tag_history:[]);
if(!h.length){console.log("(API khong tra tag_histories cho page nay)");}
else{
 h.slice().sort((a,b)=>String(a.inserted_at||a.created_at||a.updated_at||"").localeCompare(String(b.inserted_at||b.created_at||b.updated_at||"")))
 .forEach(x=>{const tid=Number(x.tag_id!=null?x.tag_id:(x.tag&&x.tag.id));
  const rm=(x.removed===true||x.is_removed===true||x.action==="remove"||x.deleted_at||x.removed_at);
  const who=(x.updated_by&&(x.updated_by.name||x.updated_by.fb_name))||x.by_name||x.staff_name||x.creator_name||(x.created_by&&(x.created_by.name||x.created_by))||"";
  const when=ft(x.inserted_at||x.created_at||x.updated_at||x.removed_at);
  console.log((rm?"GO  ":"GAN ")+tid+"="+NM(tid)+"  | "+when+(who?"  | boi: "+who:"  | boi: (khong ro -> co the BOT)"));});
}
console.log("");
console.log("Doc: dong GAN 183 co 'boi: (ten NV)' => nguoi gan tay. Neu (khong ro) => nhieu kha nang BOT tu gan.");
}catch(e){console.log("LOI: "+e.message);}})();
