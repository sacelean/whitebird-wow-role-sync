import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EmbedBuilder, ActionRowBuilder } from 'discord.js';
import { sortRaiderRows, renderRaiderReport, RAIDER_ORDERS } from '../src/raider-render.js';
const rows = [
  {id:1,name:'Zeta',realm:'realm',loot:1,ilvl:330,keys:'18/0/0',raid:'17/-/-',channelId:'123456789012345678'},
  {id:2,name:'Ana',realm:'realm',loot:3,ilvl:320,keys:'0/0/0',raid:'-/-/-',channelId:null},
  {id:3,name:'Luis',realm:'realm',loot:0,ilvl:null,keys:'—/—/—',raid:'-/-/-',channelId:null}
];
test('all six sorts preserve rows and place missing iLvl last',()=>{
 const expected={ilvl_desc:[1,2,3],ilvl_asc:[2,1,3],loot_desc:[2,1,3],loot_asc:[3,1,2],name_asc:[2,3,1],name_desc:[1,3,2]};
 for(const {value} of RAIDER_ORDERS) assert.deepEqual(sortRaiderRows(rows,value).map(row=>row.id),expected[value]);
 assert.deepEqual(rows.map(row=>row.id),[1,2,3]);
 assert.throws(()=>sortRaiderRows(rows,'invalid'));
});
test('30 raiders fit one embed with clickable channel column and six persistent controls',()=>{
 const snapshot={date:'2026-11-01',period:1090,ranks:['Oficiales','Fijo','Rotativo','Trial'],categories:['BIS','Mejora de stats','set 4p','Catalizar'],total:30,
  rows:Array.from({length:30},(_,i)=>({...rows[0],id:i+1,name:`Raider${String(i).padStart(6,'0')}`}))};
 const report=renderRaiderReport(snapshot,'loot_asc');
 assert.equal(report.embeds[0].description.split('\n').filter(line=>/^`\s*\d+ /.test(line)).length,30);
 assert.ok(report.embeds[0].description.length<=4096);
 assert.match(report.embeds[0].description,/` <#123456789012345678>/);
 assert.match(report.embeds[0].description,/Canal Raider/);
 assert.doesNotThrow(()=>new EmbedBuilder(report.embeds[0]).toJSON());
 assert.doesNotThrow(()=>new ActionRowBuilder(report.components[0]).toJSON());
 assert.equal(report.components[0].components[0].options.length,6);
 assert.equal(report.components[0].components[0].options.find(option=>option.default).value,'loot_asc');
 assert.deepEqual(report.allowedMentions,{parse:[]});
});
