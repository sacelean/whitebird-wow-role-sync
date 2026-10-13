import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateLootPanel, resolveLootChannel } from '../src/loot-panel.js';
const payload = { embeds:[{title:'Roster',description:'Everyone'}] };
function setup() {
  let row=null;
  const calls={send:0,edit:0,fetch:0};
  const message={id:'message',author:{id:'bot'},edit:async options=>{calls.edit++; assert.deepEqual(options.allowedMentions,{parse:[]}); assert.equal(options.content,null);}};
  const channel={id:'channel',name:'any-configured-channel',isTextBased:()=>true,
    send:async options=>{calls.send++; assert.deepEqual(options.allowedMentions,{parse:[]}); return message;},
    messages:{fetch:async options=>{calls.fetch++; assert.equal(options.force,true); return message;}}};
  const guild={id:'guild',client:{user:{id:'bot'}},channels:{fetch:async id=>id?channel:new Map([['channel',channel]])}};
  const store={get:()=>row,claim:(g,c,missing)=>{
    if(row&&!missing)return false;
    row={message_id:null,status:'creating',last_slot:row?.last_slot??null};return true;
  },save:(g,c,id,slot)=>{row={message_id:id,status:'ready',last_slot:slot??row?.last_slot??null};}};
  return {guild,store,calls,channel,message};
}
const config={channelId:'channel'};
test('first publish creates once; subsequent manual and weekly refreshes edit same message',async()=>{
 const s=setup();
 await updateLootPanel(s.guild,config,payload,s.store);
 await updateLootPanel(s.guild,config,payload,s.store,'2026-10-14');
 await updateLootPanel(s.guild,config,payload,s.store);
 await updateLootPanel(s.guild,config,payload,s.store,'2026-10-14');
 assert.equal(s.calls.send,1); assert.equal(s.calls.edit,2);
 assert.equal(s.store.get().message_id,'message');
});
test('only Unknown Message creates a replacement',async()=>{
 const s=setup(); await updateLootPanel(s.guild,config,payload,s.store);
 s.channel.messages.fetch=async()=>{throw {code:10008};};
 await updateLootPanel(s.guild,config,payload,s.store);
 assert.equal(s.calls.send,2);
});
test('permission or network errors do not create duplicates',async()=>{
 const s=setup(); await updateLootPanel(s.guild,config,payload,s.store);
 s.channel.messages.fetch=async()=>{throw {code:50013};};
 await assert.rejects(updateLootPanel(s.guild,config,payload,s.store),/consultar el mensaje/);
 assert.equal(s.calls.send,1);
});
test('uncertain creation remains claimed after failure and cannot resend',async()=>{
 const s=setup(); s.channel.send=async()=>{s.calls.send++;throw new Error('network');};
 await assert.rejects(updateLootPanel(s.guild,config,payload,s.store),/creación del mensaje/);
 await assert.rejects(updateLootPanel(s.guild,config,payload,s.store),/creación del mensaje/);
 assert.equal(s.calls.send,1);
});
test('missing ID is rejected without channel discovery',async()=>{
 const s=setup(); s.guild.channels.fetch=async()=>{throw new Error('should not fetch');};
 await assert.rejects(resolveLootChannel(s.guild,{}),/wow-loot-actualizar canal/);
});
test('never edits a message owned by another bot',async()=>{
 const s=setup(); await updateLootPanel(s.guild,config,payload,s.store);
 s.message.author.id='someone-else';
 await assert.rejects(updateLootPanel(s.guild,config,payload,s.store),/no pertenece/);
 assert.equal(s.calls.edit,0); assert.equal(s.calls.send,1);
});
test('manual and scheduled updates cannot create two messages concurrently',async()=>{
 const s=setup(); let release;
 s.channel.send=async()=>{s.calls.send++;await new Promise(resolve=>{release=resolve;});return s.message;};
 const first=updateLootPanel(s.guild,config,payload,s.store);
 await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(updateLootPanel(s.guild,config,payload,s.store),/en curso/);
 release(); await first;
 assert.equal(s.calls.send,1);
});

test('a blocked claim logs its state without sending or inventing a cause',async()=>{
 const s=setup(); s.store.claim();
 await assert.rejects(updateLootPanel(s.guild,config,payload,s.store),/logs de la operación/);
 assert.equal(s.calls.send,0); assert.equal(s.store.get().status,'creating');
});
test('save failure after creation preserves the claim for diagnosis, without sending again',async()=>{
 const s=setup(); s.store.save=()=>{throw {name:'SqliteError',code:'SQLITE_BUSY'};};
 await assert.rejects(updateLootPanel(s.guild,config,payload,s.store),/guardar su ID/);
 await assert.rejects(updateLootPanel(s.guild,config,payload,s.store),/logs de la operación/);
 assert.equal(s.calls.send,1);
});
