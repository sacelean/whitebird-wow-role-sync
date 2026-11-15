import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const components = {
 wow:['sacelean/whitebird-wow-role-sync',10], recruitment:['sacelean/whitebird-recruitment-bot',4],
 roulette:['sacelean/whitebird-wow-wheel',5], agent:['sacelean/whitebird-ai-agent',3], panel:['sacelean/Whitebird-control-pane',2]
};
export function validateDocument(doc, id) {
 const text=(s,max)=>typeof s==='string' && s.trim() && s.length<=max && !/[\x00-\x08\x0b-\x1f]/.test(s);
 if(!components[id] || doc?.schemaVersion!==1 || doc.id!==id || !/^\d{4}-\d{2}-\d{2}$/.test(doc.reviewedAt) || !text(doc.source,500) || !text(doc.summary,350) || !text(doc.overview,1100) || !Array.isArray(doc.topics) || doc.topics.length!==components[id][1] || doc.topics.some(s=>!text(s,1600))) throw Error('Invalid source knowledge document');
 return doc;
}
export async function publishKnowledge(doc, {env=process.env,fetchFn=fetch}={}) {
 const id=Object.keys(components).find(id=>components[id][0]===env.GITHUB_REPOSITORY);
 validateDocument(doc,id);
 const revision=env.DEPLOYED_REVISION || env.GITHUB_SHA;
 if(!/^[a-f0-9]{40}$/.test(revision) || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA) || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID) || !Number.isSafeInteger(Number(env.GITHUB_RUN_NUMBER)) || Number(env.GITHUB_RUN_NUMBER)<1 || !env.GITHUB_TOKEN) throw Error('Invalid publisher environment');
 const repository=components[id][0],api=`https://api.github.com/repos/${repository}`;
 const headers={Authorization:`Bearer ${env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'};
 const request=(path,method='GET',body)=>fetchFn(api+path,{method,headers,redirect:'error',signal:AbortSignal.timeout(15000),...(body?{body:JSON.stringify(body)}:{})});
 const branch='knowledge-published';
 const ref=await request(`/git/ref/heads/${branch}`);
 if(ref.status===404) {
  const created=await request('/git/refs','POST',{ref:`refs/heads/${branch}`,sha:env.GITHUB_SHA});
  if(!created.ok && created.status!==422) throw Error(`Cannot create own publication branch (${created.status})`);
 } else if(!ref.ok) throw Error(`Cannot read own publication branch (${ref.status})`);
 const snapshot={schemaVersion:1,repository,revision,workflowRevision:env.GITHUB_SHA,runNumber:Number(env.GITHUB_RUN_NUMBER),runUrl:`https://github.com/${repository}/actions/runs/${env.GITHUB_RUN_ID}`,verifiedAt:new Date().toISOString(),verification:env.DEPLOYED_REVISION?'manual':'pipeline',document:doc};
 for(let attempt=0;attempt<3;attempt++) {
  const current=await request(`/contents/published/knowledge.json?ref=${branch}`);
  let sha;
  if(current.ok){const file=await current.json();sha=file.sha;const old=JSON.parse(Buffer.from(file.content,'base64').toString('utf8'));if(old.runNumber>snapshot.runNumber)return;}
  else if(current.status!==404)throw Error(`Cannot read own publication (${current.status})`);
  const result=await request('/contents/published/knowledge.json','PUT',{branch,sha,message:`Publish verified ${id} knowledge for ${revision}`,content:Buffer.from(JSON.stringify(snapshot,null,2)+'\n').toString('base64')});
  if(result.ok)return;
  if(![409,422].includes(result.status))throw Error(`Cannot publish own documentation (${result.status})`);
 }
 throw Error('Concurrent publication; retry after checking deployed version');
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const doc=JSON.parse(await readFile('docs/knowledge.json','utf8'));
 if(process.argv.includes('--validate'))validateDocument(doc,doc.id);
 else await publishKnowledge(doc);
}
