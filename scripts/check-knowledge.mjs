import test from 'node:test';
import assert from 'node:assert/strict';
import { publishKnowledge, validateDocument } from './publish-knowledge.mjs';
const doc=()=>({schemaVersion:1,id:'recruitment',reviewedAt:'2026-11-15',source:'README.md',summary:'Recruitment help',overview:'Verified behavior',topics:Array(4).fill('Topic')});
const env={GITHUB_REPOSITORY:'sacelean/whitebird-recruitment-bot',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123',GITHUB_RUN_NUMBER:'2',GITHUB_TOKEN:'test-only'};
test('publishes versioned documentation only inside its own repository',async()=>{
 let puts=0;
 await publishKnowledge(doc(),{env,fetchFn:async(url,opts)=>{
  assert.ok(url.startsWith('https://api.github.com/repos/sacelean/whitebird-recruitment-bot/'));
  assert.equal(opts.redirect,'error');
  if(opts.method==='POST') {assert.equal(JSON.parse(opts.body).ref,'refs/heads/knowledge-published');return new Response('{}',{status:201});}
  if(opts.method==='PUT') {puts++;const body=JSON.parse(opts.body),snapshot=JSON.parse(Buffer.from(body.content,'base64'));assert.equal(body.branch,'knowledge-published');assert.equal(snapshot.revision,env.GITHUB_SHA);assert.equal(snapshot.document.overview,'Verified behavior');return new Response('{}',{status:201});}
  return new Response('',{status:404});
 }});assert.equal(puts,1);
});
test('rerunning an older workflow publishes the revision actually restored',async()=>{
 let writes=0;
 await publishKnowledge(doc(),{env,fetchFn:async(url,opts)=>{
  if(url.includes('/git/ref/'))return Response.json({});
  if(opts.method==='GET')return Response.json({sha:'current',content:Buffer.from(JSON.stringify({runNumber:3,revision:'b'.repeat(40)})).toString('base64')});
  writes++;const body=JSON.parse(opts.body),snapshot=JSON.parse(Buffer.from(body.content,'base64'));
  assert.equal(body.sha,'current');assert.equal(snapshot.runNumber,2);assert.equal(snapshot.revision,env.GITHUB_SHA);
  assert.equal(snapshot.document.overview,'Verified behavior');
  return Response.json({});
 }});assert.equal(writes,1);
});
test('invalid documents and credentials fail before publishing',async()=>{
 assert.throws(()=>validateDocument({...doc(),topics:[]},'recruitment'));
 assert.throws(()=>validateDocument({...doc(),id:'wow'},'recruitment'));
 await assert.rejects(publishKnowledge(doc(),{env:{...env,GITHUB_TOKEN:''},fetchFn:()=>assert.fail()}));
});
test('a branch conflict can retry while the document blob is unchanged',async()=>{
 let reads=0,puts=0;
 await publishKnowledge(doc(),{env,fetchFn:async(url,opts)=>{
  if(url.includes('/git/ref/'))return Response.json({});
  if(opts.method==='GET'){reads++;return Response.json({sha:'same-document',content:Buffer.from(JSON.stringify({runNumber:1})).toString('base64')});}
  const body=JSON.parse(opts.body);assert.equal(body.sha,'same-document');puts++;
  return new Response('{}',{status:puts===1?409:200});
 }});assert.equal(puts,2);
});

test('a concurrent document change aborts without overwriting the new publication',async()=>{
 let reads=0,writes=0;
 await assert.rejects(publishKnowledge(doc(),{env,fetchFn:async(url,opts)=>{
  if(url.includes('/git/ref/'))return Response.json({});
  if(opts.method==='GET'){reads++;return Response.json({sha:`blob-${reads}`});}
  writes++;return new Response('{}',{status:409});
 }}),/Publication changed concurrently/);
 assert.equal(writes,1);assert.equal(reads,2);
});
test('a manually verified rollback records its target revision even after a newer run',async()=>{
 let saved;
 await publishKnowledge(doc(),{env:{...env,DEPLOYED_REVISION:'c'.repeat(40)},fetchFn:async(url,opts)=>{
  if(url.includes('/git/ref/'))return Response.json({});
  if(opts.method==='GET')return Response.json({sha:'current',content:Buffer.from(JSON.stringify({runNumber:99})).toString('base64')});
  saved=JSON.parse(Buffer.from(JSON.parse(opts.body).content,'base64'));return Response.json({});
 }});
 assert.equal(saved.revision,'c'.repeat(40));assert.equal(saved.verification,'manual');
});
