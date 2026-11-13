import mongoose from 'mongoose';
const schema=new mongoose.Schema({
  key:{type:String,required:true,index:true},
  version:{type:Number,required:true,min:1},
  name:{type:String,required:true},
  description:{type:String,default:''},
  fields:{type:[mongoose.Schema.Types.Mixed],default:[]},
  rules:{type:[mongoose.Schema.Types.Mixed],default:[]},
  stages:{type:[mongoose.Schema.Types.Mixed],default:[]},
  defaultAction:{type:mongoose.Schema.Types.Mixed,required:true},
  active:{type:Boolean,default:true}
},{timestamps:true,optimisticConcurrency:true});
schema.index({key:1,version:1},{unique:true});
export default mongoose.model('Workflow',schema);
