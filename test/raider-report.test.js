import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = mkdtempSync(join(tmpdir(), 'whitebird-raider-report-'));
process.env.DATABASE_PATH = join(directory, 'test.sqlite');
const { db, getRaiderPanel, getRaiderView } = await import('../src/database.js');
const { publishRaiderReport, sortRaiderReport } = await import('../src/raider-report.js');
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
const snapshot = {date:'2026-11-01',period:1090,ranks:['Fijo'],categories:['BIS'],total:3,rows:[
 {id:1,name:'Zeta',realm:'realm',loot:1,ilvl:330,keys:'0/0/0',raid:'-/-/-',channelId:'123456789012345678'},
 {id:2,name:'Ana',realm:'realm',loot:2,ilvl:320,keys:'0/0/0',raid:'-/-/-',channelId:null}
]};
function setup(id) {
 const calls={send:0,edit:0,payload:null};
 const message={id:'message',author:{id:'bot'},edit:async payload=>{calls.edit++;calls.payload=payload;}};
 const channel={id:'channel',isTextBased:()=>true,messages:{fetch:async()=>message},send:async payload=>{calls.send++;calls.payload=payload;return message;}};
 const guild={id,client:{user:{id:'bot'}},channels:{fetch:async()=>channel}};
 return {guild,calls,message,channel};
}
test('sorting reuses persisted data and message, preserves weekly marker and next refresh order',async()=>{
 const s=setup('sorting');
 await publishRaiderReport(s.guild,'channel',snapshot,'2026-10-28');
 await sortRaiderReport(s.guild,'channel','message','name_asc');
 assert.equal(s.calls.send,1);assert.equal(s.calls.edit,1);
 assert.ok(s.calls.payload.embeds[0].description.indexOf('Ana')<s.calls.payload.embeds[0].description.indexOf('Zeta'));
 assert.equal(getRaiderPanel('sorting','channel').last_slot,'2026-10-28');
 assert.deepEqual(getRaiderView('sorting','channel'),{snapshot,order:'name_asc'});
 const refreshed={...snapshot,date:'2026-11-04'};
 await publishRaiderReport(s.guild,'channel',refreshed,'2026-11-04');
 assert.deepEqual(getRaiderView('sorting','channel'),{snapshot:refreshed,order:'name_asc'});
});
test('already completed weekly slot cannot replace the displayed snapshot',async()=>{
 const s=setup('weekly');
 await publishRaiderReport(s.guild,'channel',snapshot,'2026-10-28');
 await publishRaiderReport(s.guild,'channel',{...snapshot,total:999},'2026-10-28');
 assert.equal(getRaiderView('weekly','channel').snapshot.total,3);
 assert.equal(s.calls.edit,0);
});
test('rejects stale messages and invalid orders without editing',async()=>{
 const s=setup('stale');
 await publishRaiderReport(s.guild,'channel',snapshot);
 await assert.rejects(sortRaiderReport(s.guild,'channel','old-message','loot_desc'),/ya no está disponible/);
 await assert.rejects(sortRaiderReport(s.guild,'channel','message','invalid'),/no válido/);
 assert.equal(s.calls.edit,0);
});
test('failed sort edit leaves the previous order and snapshot unchanged',async()=>{
 const s=setup('failure');
 await publishRaiderReport(s.guild,'channel',snapshot);
 s.message.edit=async()=>{throw {code:50013};};
 await assert.rejects(sortRaiderReport(s.guild,'channel','message','loot_asc'),/editar/);
 assert.equal(getRaiderView('failure','channel').order,'ilvl_desc');
});
test('refresh and sort are serialized so older data cannot overwrite a new report',async()=>{
 const s=setup('concurrent');
 await publishRaiderReport(s.guild,'channel',snapshot);
 let release;
 s.message.edit=async()=>{await new Promise(resolve=>{release=resolve;});};
 const pending=publishRaiderReport(s.guild,'channel',{...snapshot,total:4});
 await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(sortRaiderReport(s.guild,'channel','message','loot_desc'),/en curso/);
 release(); await pending;
 assert.equal(getRaiderView('concurrent','channel').snapshot.total,4);
});
