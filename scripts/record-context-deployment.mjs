import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// Run only after a successful deployment health check. Credential stays in CI.
const repositories = new Set(['sacelean/whitebird-wow-role-sync','sacelean/whitebird-recruitment-bot','sacelean/whitebird-wow-wheel','sacelean/whitebird-ai-agent','sacelean/Whitebird-control-pane']);
const ids = {'sacelean/whitebird-wow-role-sync':'wow','sacelean/whitebird-recruitment-bot':'recruitment','sacelean/whitebird-wow-wheel':'roulette','sacelean/whitebird-ai-agent':'agent','sacelean/Whitebird-control-pane':'panel'};
export async function recordDeployment({ env = process.env, fetchFn = fetch } = {}) {
const { GITHUB_REPOSITORY: repository, GITHUB_SHA: workflowRevision, DEPLOYED_REVISION: deployedRevision, GITHUB_RUN_ID: runId, GITHUB_RUN_NUMBER: number, WHITEBIRD_CONTEXT_WRITE_TOKEN: token } = env;
const revision = deployedRevision || workflowRevision;
if (!repositories.has(repository) || !/^[a-f0-9]{40}$/.test(revision) || !/^[0-9]+$/.test(runId) || !/^[1-9][0-9]*$/.test(number) || !token) throw Error('Missing or invalid deployment receipt configuration');
const url=`https://api.github.com/repos/sacelean/Whitebird-context/contents/deployments/${ids[repository]}.json`;
const headers={ Authorization:`Bearer ${token}`, Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json' };
const receipt={ repository, revision, runNumber:Number(number), runUrl:`https://github.com/${repository}/actions/runs/${runId}`, verifiedAt:new Date().toISOString() };
for(let attempt=0;attempt<3;attempt++) {
 const current=await fetchFn(`${url}?ref=main`,{headers,redirect:'error',signal:AbortSignal.timeout(15000)});
 let sha;
 if(current.ok) {
  const file=await current.json(); sha=file.sha;
  const old=JSON.parse(Buffer.from(file.content,'base64').toString('utf8'));
  if(old.runNumber>receipt.runNumber) { console.log('Newer deployment already recorded.'); return; }
 } else if(current.status!==404) throw Error(`Cannot read deployment receipt (${current.status})`);
 const result=await fetchFn(url,{method:'PUT',headers,redirect:'error',signal:AbortSignal.timeout(15000),body:JSON.stringify({message:`Record verified ${ids[repository]} deployment ${revision}`,branch:'main',sha,content:Buffer.from(JSON.stringify(receipt,null,2)+'\n').toString('base64')})});
 if(result.ok) { console.log('Verified deployment recorded in Whitebird-context.'); return; }
 if(![409,422].includes(result.status)) throw Error(`Cannot record deployment receipt (${result.status})`);
}
throw Error('Deployment receipt changed concurrently; retry the notification after checking deployment state');

}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await recordDeployment();
