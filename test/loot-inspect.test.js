import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits as P } from 'discord.js';
import { inspectPermissions } from '../src/loot-inspect.js';
const all=P.ViewChannel|P.SendMessages|P.EmbedLinks|P.ReadMessageHistory;
const roles=[{id:'g',permissions:String(all)},{id:'r',permissions:'0'}];
const member={roles:['r']};
test('read-only inspection applies role and member channel overrides in order',()=>{
 const result=inspectPermissions('g','b',roles,member,{permission_overwrites:[
  {id:'g',type:0,deny:String(P.EmbedLinks),allow:'0'},
  {id:'r',type:0,deny:'0',allow:String(P.EmbedLinks)},
  {id:'b',type:1,deny:String(P.SendMessages),allow:'0'}
 ]});
 assert.equal(result['Insertar enlaces'],true); assert.equal(result['Enviar mensajes'],false);
});
test('read-only inspection respects administrator permissions',()=>{
 const result=inspectPermissions('g','b',[{id:'g',permissions:String(P.Administrator)}],member,{permission_overwrites:[{id:'g',type:0,deny:String(all),allow:'0'}]});
 assert.ok(Object.values(result).every(Boolean));
});
