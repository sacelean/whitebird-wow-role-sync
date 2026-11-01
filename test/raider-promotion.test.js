import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { notifyRaiderPromotion, raiderPromotionMessage, getRaiderPromotion } from '../src/raider-promotion.js';
const directory=mkdtempSync(join(tmpdir(),'whitebird-promotion-'));
process.env.DATABASE_PATH=join(directory,'test.sqlite');
const {db,raiderPromotionStore:store}=await import('../src/database.js');
after(()=>{db.close();rmSync(directory,{recursive:true,force:true});});
function setup(user) {
 const messages=[];
 const event={guild:{id:'guild'},link:{user_id:user,character_name:'Main',realm_slug:'realm'},promoted:true,
  channel:{id:'channel',isTextBased:()=>true,send:async message=>{messages.push(message);return {id:'message'};}}};
 return {event,messages};
}
test('felicita en su canal con asistencia por defecto y reparaciones futuras; solo menciona al destinatario',async()=>{
 const {event,messages}=setup('congrats');
 assert.equal(await notifyRaiderPromotion(event,store),true);
 assert.equal(messages.length,1);
 assert.match(messages[0].content,/Recluta.*Raider/);
 assert.match(messages[0].content,/WoWAudit.*por defecto/);
 assert.match(messages[0].content,/no puedas venir/);
 assert.match(messages[0].content,/cuando se activen/);
 assert.deepEqual(messages[0].allowedMentions,{users:['congrats']});
 assert.equal(store.get('guild','congrats').status,'sent');
 assert.equal(await notifyRaiderPromotion(event,store),false);
 assert.equal(messages.length,1);
 assert.ok(raiderPromotionMessage('123456789012345678').length<2000);
});
test('la deduplicación persiste después de reiniciar',async()=>{
 const {event,messages}=setup('restart');
 await notifyRaiderPromotion(event,store);
 const reopened=await import('../src/database.js?promotion-restart');
 try { assert.equal(await notifyRaiderPromotion(event,reopened.raiderPromotionStore),false); }
 finally {reopened.db.close();}
 assert.equal(messages.length,1);
});
test('si falta el canal queda pendiente y se envía en la siguiente sincronización como Raider',async()=>{
 const {event,messages}=setup('pending');
 await assert.rejects(notifyRaiderPromotion({...event,channel:null},store),/pendiente/);
 assert.equal(store.get('guild','pending').status,'pending');
 await notifyRaiderPromotion({...event,promoted:false},store);
 assert.equal(messages.length,1);
});
test('no envía nada a un Raider anterior ni a un main cambiado',async()=>{
 const {event,messages}=setup('existing');
 assert.equal(await notifyRaiderPromotion({...event,promoted:false},store),false);
 store.enqueue('guild','existing','OldMain','realm');
 assert.equal(await notifyRaiderPromotion(event,store),false);
 assert.equal(messages.length,0);
});
test('un fallo de permisos confirmado permite reintento; un fallo de red incierto no duplica envíos',async()=>{
 for(const [user,error,status] of [['permission',{code:50013},'pending'],['network',new Error('ECONNRESET'),'sending']]) {
  const {event,messages}=setup(user);
  let attempts=0;
  const failing={...event,channel:{...event.channel,send:async()=>{attempts++;throw error;}}};
  await assert.rejects(notifyRaiderPromotion(failing,store),/No se confirmó/);
  assert.equal(store.get('guild',user).status,status);
  if(status==='pending') {
   await notifyRaiderPromotion({...event,promoted:false},store);
   assert.equal(messages.length,1);
  } else {
   await assert.rejects(notifyRaiderPromotion(failing,store),/sin confirmar/);
   assert.equal(attempts,1);
  }
 }
});
test('la reclamación atómica impide envíos concurrentes duplicados',async()=>{
 const {event}=setup('concurrent');let release,attempts=0;
 event.channel.send=async()=>{attempts++;await new Promise(resolve=>{release=resolve;});return {id:'message'};};
 const first=notifyRaiderPromotion(event,store);
 await assert.rejects(notifyRaiderPromotion(event,store),/sin confirmar/);
 release();await first;assert.equal(attempts,1);
});
test('solo detecta roles de rango mapeados con nombres Recluta y Raider',()=>{
 const roles=new Map([['r',{id:'r',name:' RECLUTA '}],['x',{id:'x',name:'Raider'}],['f',{id:'f',name:'Fijo'}]]);
 const guild={roles:{cache:roles}},member={roles:{cache:new Map([['r',roles.get('r')]])}};
 assert.deepEqual(getRaiderPromotion(guild,member,'x',{0:'r',2:'x'}),{targetIsRaider:true,promoted:true});
 assert.equal(getRaiderPromotion(guild,member,'f',{0:'r',2:'f'}).promoted,false);
 assert.equal(getRaiderPromotion(guild,member,'x',{2:'x'}).promoted,false);
});
