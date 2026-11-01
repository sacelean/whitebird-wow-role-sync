import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditGet, buildLootRanking, fetchRaiderTableReport, getRaiderConfig, raiderErrorMessage, weeklySlot, weeklyCutoff } from '../src/wowaudit.js';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/wowaudit.json',import.meta.url)));
const roster = fixture['/v1/characters'];
const history = fixture['/v1/loot_history/{id}'].history_items;
const options = { start:Date.parse('2024-10-01T00:00Z'),end:Date.parse('2024-10-02T00:00Z'),categories:['Major','Minor'],ranks:['Main'] };
test('official example: recipient, zeros, stable ties, duplicate imports and discarded awards',()=>{
 const result = buildLootRanking(roster,[...history,history[0],{...history[0],id:99},{...history[0],id:100,rclootcouncil_id:'other',discarded:true}], [{character_name:'kormash',realm_slug:'stormrage',user_id:'123'}],options);
 assert.equal(result.total,2); assert.equal(result.all[0].name,'Kormash'); assert.equal(result.all[0].userId,'123');
 assert.equal(result.all.at(-1).count,0); assert.deepEqual(result.all.map(r=>r.position),[1,2,2,2]);
});
test('time boundaries, tracked ranks and alts stay separate',()=>{
 const alt = {...roster[0],id:9,name:'Alt',rank:'Alt'};
 const result = buildLootRanking([...roster,alt],[{...history[0],awarded_at:new Date(options.end).toISOString()}],[],options);
 assert.equal(result.size,4); assert.equal(result.total,0);
 assert.equal(buildLootRanking([...roster,alt],[],[],options).size,4);
});
test('reject malformed responses and conflicting duplicates',()=>{
 assert.throws(()=>buildLootRanking(roster,undefined,[],options));
 assert.throws(()=>buildLootRanking(roster,[...history,{...history[0],character_id:1}],[],options));
 assert.throws(()=>buildLootRanking([...roster,{...roster[0],id:10}],history,[],options));
 assert.throws(()=>buildLootRanking(roster,[{...history[0],awarded_at:null}],[],options));
});
test('full roster is never cut to five and tied entries share positions',()=>{
 const r = Array.from({length:7},(_,i)=>({...roster[0],id:i+1,name:`Person${i}`}));
 const result=buildLootRanking(r,[],[],options);
 assert.equal(result.all.length,7);
 assert.ok(result.all.every(x=>x.position===1));
});
test('Madrid Wednesday at 20:00 across DST, not host timezone',()=>{
 for(const time of ['2026-07-01T18:00Z','2026-10-28T19:00Z']) assert.ok(weeklySlot(Date.parse(time)));
 for(const time of ['2026-07-01T17:59Z','2026-10-28T18:59Z','2026-10-29T19:00Z']) assert.equal(weeklySlot(Date.parse(time)),null);
});
test('optional config validates before requests',()=>{
 assert.equal(getRaiderConfig({}),null);
 assert.equal(getRaiderConfig({WOWAUDIT_API_KEY:'  '}),null);
 assert.throws(()=>getRaiderConfig({WOWAUDIT_API_KEY:'secret',WOWAUDIT_LOOT_WINDOW_DAYS:'0'}));
});
test('HTTP authorization errors never leak body or key',async()=>{
 await assert.rejects(auditGet('/v1/period','secret',async()=>({ok:false,status:401})),/^Error: WoWAudit: HTTP 401\.$/);
});

test('fixed cutoff is Madrid 20:00 in summer and winter',()=>{
 assert.equal(new Date(weeklyCutoff('2026-07-01')).toISOString(),'2026-07-01T18:00:00.000Z');
 assert.equal(new Date(weeklyCutoff('2026-10-28')).toISOString(),'2026-10-28T19:00:00.000Z');
});

test('only Mythic Main and the four selected categories, keeping zero-loot mains',()=>{
 const trial={...roster[0], id:9, name:'Trial', rank:'Trial'};
 const award=(id,category,difficulty='mythic',character_id=2)=>({...history[0],id,rclootcouncil_id:`import-${id}`,difficulty,character_id,response_type:category===null?null:{name:category}});
 const result=buildLootRanking([...roster,trial],[
  award(11,'BIS'),award(12,'Mejora de stats'),award(13,'set 4p'),
  award(14,' bis '),award(15,'Mejora de stats','heroic'),award(16,'Offspec'),
  award(17,'BIS','mythic',9),award(18,null),award(19,'BIS extra'),
  award(20,'Catalizar'),award(21,'set 4p Catalizar'),
 ],[],{start:options.start,end:options.end,ranks:['Main']});
 assert.equal(result.total,5); assert.equal(result.size,4);
 assert.equal(result.all[0].name,'Kormash'); assert.equal(result.all.at(-1).count,0);
 assert.ok(!result.all.some(r=>r.name==='Trial'));
});

test('preview diagnostics expose only controlled errors, never arbitrary exception contents',()=>{
 assert.equal(raiderErrorMessage(new Error('secret-token')),'WoWAudit: error interno al generar o mostrar el informe.');
 try { getRaiderConfig({WOWAUDIT_API_KEY:'secret-token',WOWAUDIT_LOOT_WINDOW_DAYS:'0'}); } catch(error) {
  assert.match(raiderErrorMessage(error),/WOWAUDIT_LOOT_WINDOW_DAYS/);
  assert.doesNotMatch(raiderErrorMessage(error),/secret-token/);
 }
});

test('real Whitebird rank distribution includes all 30 tracked characters including trials',()=>{
 const tracked=[];
 for(const [rank,count] of [['Oficiales',3],['Fijo',17],['Rotativo',3],['Trial',7]]) {
  for(let i=0;i<count;i++) tracked.push({...roster[0],id:tracked.length+1,name:`Character${tracked.length}`,rank});
 }
 tracked.push({...roster[0],id:31,name:'Inactive',rank:'Fijo',status:'pending'});
 const loot=[...history.map((item,i)=>({...item,id:i+1,rclootcouncil_id:`live-${i}`,character_id:i===0?1:24,response_type:{name:'BIS'}}))];
 const result=buildLootRanking(tracked,loot,[],{start:options.start,end:options.end});
 assert.equal(result.size,30); assert.equal(result.total,2); assert.equal(result.all.at(-1).count,0);
 assert.equal(result.all.filter(c=>c.rank==='Trial').length,7);
 const configured=buildLootRanking(tracked,loot,[],{start:options.start,end:options.end,ranks:[' fijo ']});
 assert.equal(configured.size,17);
});
test('rank configuration defaults to the verified ranks and rejects empty entries',()=>{
 const env={WOWAUDIT_API_KEY:'test'};
 assert.deepEqual(getRaiderConfig(env).ranks,['Oficiales','Fijo','Rotativo','Trial']);
 assert.throws(()=>getRaiderConfig({...env,WOWAUDIT_LOOT_RANKS:'Fijo,'}),/WOWAUDIT_LOOT_RANKS/);
});

test('merged categories count their final label exactly once, matching the website',()=>{
 const award=(id,name,propagated_to)=>({...history[0],id,rclootcouncil_id:`merged-${id}`,response_type:{name,propagated_to}});
 const result=buildLootRanking(roster,[
  award(101,'Necesidad',{name:'BIS'}),
  award(102,'Mejora grande',{name:'Mejora de stats'}),
  award(103,'BIS',{name:'OFF SPEC'}),
  award(104,'BIS',null),
  award(105,'Catalizar',null),
  award(106,'set 4p',null),
 ],[],{start:options.start,end:options.end,ranks:['Main']});
 assert.equal(result.total,5); assert.equal(result.all[0].count,5);
 assert.equal(result.all.at(-1).count,0);
});
test('conflicting duplicate category mappings cancel the report',()=>{
 const original={...history[0],response_type:{name:'Necesidad',propagated_to:{name:'BIS'}}};
 assert.throws(()=>buildLootRanking(roster,[original,{...original,response_type:{name:'Necesidad',propagated_to:{name:'OFF SPEC'}}}],[],options));
});

test('API configuration has no destination; only the command stores a channel',()=>{
 const config=getRaiderConfig({WOWAUDIT_API_KEY:'test'});
 assert.equal(config.apiKey,'test');
 assert.equal(Object.hasOwn(config,'channelId'),false);
 assert.equal(Object.hasOwn(config,'channelName'),false);
});

async function reportFixture(size = 30, links = [], legacy = false) {
 const period=JSON.parse(readFileSync(new URL('./fixtures/wowaudit-period-live.json',import.meta.url)));
 const reportRoster=Array.from({length:size},(_,i)=>({...roster[0],id:i+1,name:`Raider${String(i).padStart(6,'0')}`,rank:'Fijo'}));
 const paths=[];
 const snapshot=await fetchRaiderTableReport({apiKey:'private',days:30,categories:['BIS','Mejora de stats','set 4p','Catalizar'],ranks:['Fijo']},links,Date.parse('2026-10-13T18:00Z'),async(url,opts)=>{
   assert.equal(opts.headers.Authorization,'Bearer private');
   const path=new URL(url).pathname; paths.push(path);
   const data=path==='/v1/period'?{...period,current_period:1090,current_season:{...period.current_season,...(legacy?{keystone_season_id:18}:{})}}:path==='/v1/characters'?reportRoster:
    path==='/v1/historical_data'?{characters:reportRoster.map(c=>({id:c.id,data:{dungeons_done:[{level:18}],vault_options:{raids:{option_1:17,option_2:null,option_3:null}}}}))}:
    path==='/v1/loot_history/18'?{history_items:[]}:
    {id:Number(path.split('/').at(-1)),details:{currentItemLevel:329.94}};
   return {ok:true,json:async()=>data};
 });
 return {snapshot,paths,reportRoster};
}
test('raider data uses season fallback and legacy season ID with bounded authenticated profile requests',async()=>{
 for (const legacy of [false,true]) {
  const {snapshot,paths}=await reportFixture(30,[],legacy);
  assert.equal(snapshot.rows.length,30);
  assert.equal(snapshot.rows[0].keys,'18/0/0');
  assert.equal(snapshot.rows[0].raid,'17/-/-');
  assert.equal(snapshot.rows[0].ilvl,329.94);
  assert.equal(paths.filter(p=>p==='/v1/loot_history/18').length,1);
 }
});
test('invalid legacy season ID cancels the raider report before querying the roster',async()=>{
 let calls=0;
 await assert.rejects(fetchRaiderTableReport({apiKey:'private'},[],Date.parse('2026-10-13T18:00Z'),async()=>{
  calls++; return {ok:true,json:async()=>({current_period:1090,current_season:{id:18,keystone_season_id:'invalid',start_date:'2026-08-11'}})};
 }),/temporada/);
 assert.equal(calls,1);
});
test('channel links require a unique main identity',async()=>{
 const {reportRoster}=await reportFixture(1);
 const link={character_name:reportRoster[0].name,realm_slug:reportRoster[0].realm,user_id:'123',raider_channel_id:'123456789012345678'};
 const unique=await reportFixture(1,[link]);
 assert.equal(unique.snapshot.rows[0].channelId,link.raider_channel_id);
 const ambiguous=await reportFixture(1,[link,{...link,user_id:'456'}]);
 assert.equal(ambiguous.snapshot.rows[0].channelId,null);
});
