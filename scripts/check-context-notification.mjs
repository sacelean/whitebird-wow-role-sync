import test from 'node:test';
import assert from 'node:assert/strict';
import { recordDeployment } from '../scripts/record-context-deployment.mjs';
const env={GITHUB_REPOSITORY:'sacelean/whitebird-wow-role-sync',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123',GITHUB_RUN_NUMBER:'2',WHITEBIRD_CONTEXT_WRITE_TOKEN:'fake'};
test('verified notification creates only its own receipt on main',async()=>{
 let calls=0;
 await recordDeployment({env,fetchFn:async(url,opts)=>{
  assert.match(url,/Whitebird-context\/contents\/deployments\/wow.json/);
  assert.equal(opts.redirect,'error');calls++;
  if(!opts.method) return new Response('',{status:404});
  const body=JSON.parse(opts.body),receipt=JSON.parse(Buffer.from(body.content,'base64'));
  assert.equal(body.branch,'main');assert.equal(receipt.revision,env.GITHUB_SHA);assert.equal(receipt.runNumber,2);
  return new Response('{}',{status:201});
 }});assert.equal(calls,2);
});
test('concurrent receipt update is retried and a newer deployment cannot be overwritten',async()=>{
 let calls=0;
 await recordDeployment({env,fetchFn:async(url,opts)=>{
  calls++;
  if(opts.method) return new Response('',{status:409});
  return Response.json({sha:'old',content:Buffer.from(JSON.stringify({runNumber:calls===1?1:3})).toString('base64')});
 }});assert.equal(calls,3);
});
test('missing credential and API failures do not claim success',async()=>{
 await assert.rejects(recordDeployment({env:{...env,WHITEBIRD_CONTEXT_WRITE_TOKEN:''},fetchFn:()=>assert.fail()}));
 await assert.rejects(recordDeployment({env,fetchFn:async()=>new Response('',{status:403})}));
});
