import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActionRowBuilder } from 'discord.js';
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
test('30 raiders fit one non-embed message with aligned table and clickable channels',()=>{
 const snapshot={date:'2026-11-01',period:1090,ranks:['Oficiales','Fijo','Rotativo','Trial'],categories:['BIS','Mejora de stats','set 4p','Catalizar'],total:30,
  rows:Array.from({length:30},(_,i)=>({...rows[0],id:i+1,name:`Raider${String(i).padStart(6,'0')}`}))};
 const report=renderRaiderReport(snapshot,'loot_asc');
 const table=report.components[0].content.split('```text\n')[1].split('\n```')[0].split('\n');
 assert.equal(table.length,31);
 assert.equal(new Set(table.map(line=>line.length)).size,1);
 assert.ok(report.components[0].content.length<=4000);
 assert.equal(report.flags,1<<15);
 assert.equal(report.embeds,undefined);
 assert.equal(report.components.length,2);
 assert.match(report.components[0].content,/Canales Raider/);
 assert.match(report.components[0].content,/<#123456789012345678>/);
 assert.doesNotThrow(()=>new ActionRowBuilder(report.components[1]).toJSON());
 assert.equal(report.components[1].components[0].options.length,6);
 assert.equal(report.components[1].components[0].options.find(option=>option.default).value,'loot_asc');
 assert.deepEqual(report.allowedMentions,{parse:[]});
 assert.doesNotMatch(report.components[0].content,/Página/);
});
test('wide vault values stay aligned and channel numbers follow the selected sort',()=>{
 const snapshot={date:'2026-11-01',period:1090,ranks:[],categories:[],total:4,
  rows:rows.map(row=>({...row,raid:'318/318/318',keys:'12/12/12'}))};
 const report=renderRaiderReport(snapshot,'name_asc');
 const table=report.components[0].content.split('```text\n')[1].split('\n```')[0].split('\n');
 assert.equal(new Set(table.map(line=>line.length)).size,1);
 assert.match(table[1],/Ana/);
 assert.match(table[3],/Zeta/);
 assert.ok(report.components[0].content.includes('1. —\n2. —\n3. <#123456789012345678>'));
});
