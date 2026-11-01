import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const directory=mkdtempSync(join(tmpdir(),'whitebird-raider-scheduler-'));
process.env.DATABASE_PATH=join(directory,'test.sqlite');
process.env.WOWAUDIT_API_KEY='test';
const { db, setRaiderDestination, getRaiderPanel }=await import('../src/database.js');
const { startRaiderScheduler }=await import('../src/raider-scheduler.js');
after(()=>{db.close();rmSync(directory,{recursive:true,force:true});});
test('weekly tick publishes only one raider report with loot and sorting controls',async(t)=>{
 t.mock.method(Date,'now',()=>Date.parse('2026-11-04T19:05:00Z'));
 const requests=[];
 t.mock.method(globalThis,'fetch',async(url)=>{
  const path=new URL(url).pathname;requests.push(path);
  const data=path==='/v1/period'?{current_period:1090,current_season:{id:18,start_date:'2026-08-11'}}:
   path==='/v1/characters'?[{id:1,name:'Main',realm:'realm',rank:'Fijo',status:'tracking'}]:
   path==='/v1/historical_data'?{characters:[]}:
   path==='/v1/loot_history/18'?{history_items:[]}:
   {id:1,details:{currentItemLevel:330}};
  return {ok:true,json:async()=>data};
 });
 let sent=0,payload,stop;
 const channel={id:'channel',isTextBased:()=>true,messages:{},send:async value=>{sent++;payload=value;return {id:'message'};}};
 const guild={id:'scheduler',channels:{fetch:async()=>channel}};
 const client={guilds:{fetch:async()=>guild},once:(event,listener)=>{stop=listener;}};
 setRaiderDestination(guild.id,channel.id);
 startRaiderScheduler(client,guild.id);
 try {
  for(let i=0;i<20 && !getRaiderPanel(guild.id,channel.id)?.message_id;i++) await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sent,1);
  assert.match(payload.embeds[0].title,/Raiders/);
  assert.match(payload.embeds[0].description,/Loot/);
  assert.equal(payload.components[0].components[0].custom_id,'wow-raiders-sort');
  assert.equal(requests.filter(path=>path==='/v1/loot_history/18').length,1);
  assert.equal(getRaiderPanel(guild.id,channel.id).last_slot,'2026-11-04');
 } finally {stop?.();}
});
