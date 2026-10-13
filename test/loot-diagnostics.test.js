import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logLootFailure } from '../src/loot-diagnostics.js';
test('diagnostics preserve HTTP/Discord codes and rejected field paths without secrets or bodies',()=>{
 let line;
 const result=logLootFailure('create-message',{
  name:'DiscordAPIError[50035]',status:400,code:50035,message:'API KEY secret',
  url:'https://discord.com/token-secret',requestBody:{token:'secret'},
  rawError:{message:'secret',errors:{embeds:{0:{description:{_errors:[{code:'BASE_TYPE_MAX_LENGTH',message:'secret-description'}]}}}}}
 },{guildId:'g',channelId:'c'},s=>{line=s;});
 assert.equal(result.status,400); assert.equal(result.code,50035);
 assert.deepEqual(result.invalidFields,[{path:'embeds.0.description',code:'BASE_TYPE_MAX_LENGTH'}]);
 assert.doesNotMatch(line,/secret|API KEY|https:/);
});
test('blocked creation is logged as state with no invented original cause',()=>{
 const result=logLootFailure('blocked-creation',null,{panelStatus:'creating'},()=>{});
 assert.equal(result.status,null); assert.equal(result.code,null); assert.equal(result.panelStatus,'creating');
});
test('network causes are logged by code only',()=>{
 const result=logLootFailure('create-message',{cause:{code:'ECONNRESET',message:'private data'}},{},()=>{});
 assert.equal(result.causeCode,'ECONNRESET');
});
