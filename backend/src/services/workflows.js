import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Workflow from '../models/Workflow.js';
import {validateDefinition} from '../engine/rules.js';
const base=path.dirname(fileURLToPath(import.meta.url));
export async function seedWorkflows(){
  for(const name of ['expense','vendor']){
    const def=JSON.parse(await fs.readFile(path.join(base,'../workflows',name+'.json'),'utf8'));
    validateDefinition(def);
    await Workflow.updateOne({key:def.key,version:1},{$setOnInsert:{...def,active:true}},{upsert:true});
  }
}
export async function latest(key){
  return Workflow.findOne({key,active:true}).sort({version:-1}).lean();
}
export async function publish(key,body){
  const last=await Workflow.findOne({key}).sort({version:-1}).lean();
  if(!last){const err=new Error('Workflow not found');err.status=404;throw err;}
  const def={key,name:body.name||last.name,description:body.description??last.description,
    version:last.version+1,fields:body.fields??last.fields,rules:body.rules??last.rules,
    stages:body.stages??last.stages,defaultAction:body.defaultAction??last.defaultAction,active:true};
  validateDefinition(def);
  try{return await Workflow.create(def)}catch(e){if(e.code===11000){e.status=409;e.message='Version conflict: retry publication';}throw e;}
}
