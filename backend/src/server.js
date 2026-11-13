import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import api from './routes/api.js';
import {seedWorkflows} from './services/workflows.js';
import {runDueRetries} from './services/requests.js';
const app=express();
app.disable('x-powered-by');
app.use(cors({origin:(process.env.FRONTEND_ORIGIN||'http://localhost:5173').split(',')}));
app.use(express.json({limit:'64kb'}));
app.use('/api',api);
app.use((req,res)=>res.status(404).json({error:'Route not found'}));
app.use((err,req,res,next)=>{
  const validation=err.name==='ZodError';
  const status=validation?400:err.status||500;
  if(status===500)console.error(err);
  res.status(status).json({error:validation?err.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '):status===500?'Internal server error':err.message});
});
const uri=process.env.MONGO_URI;
if(!uri){console.error('Missing MONGO_URI. Copy backend/.env.example to backend/.env');process.exit(1);}
try{
  await mongoose.connect(uri,{serverSelectionTimeoutMS:7000});
  await seedWorkflows();
  const port=Number(process.env.PORT||5000);
  app.listen(port,()=>console.log(`FlowForge API listening at http://localhost:${port}`));
  const timer=setInterval(()=>runDueRetries().catch(e=>console.error('Worker:',e)),Number(process.env.RETRY_POLL_MS||3000));
  timer.unref();
}catch(e){console.error('Database startup failed:',e.message);process.exit(1);}
