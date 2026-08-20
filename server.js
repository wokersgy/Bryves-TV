require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;
const MUX_TOKEN_ID = process.env.MUX_TOKEN_ID;
const MUX_TOKEN_SECRET = process.env.MUX_TOKEN_SECRET;
const FIREBASE_DATABASE_URL = process.env.FIREBASE_DATABASE_URL || "https://bryvestv-default-rtdb.firebaseio.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

app.use(cors());
app.use(express.json());

function auth(req,res,next){
  if(!ADMIN_PASSWORD || req.headers["x-admin-password"] !== ADMIN_PASSWORD)
    return res.status(401).json({success:false,error:"Unauthorized"});
  next();
}
async function firebase(p,m="GET",body){
  const r=await fetch(`${FIREBASE_DATABASE_URL.replace(/\/$/,"")}/${p}.json`,{
    method:m,headers:{"Content-Type":"application/json"},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const t=await r.text(); let d=null; try{d=t?JSON.parse(t):null}catch{d=t}
  if(!r.ok) throw new Error(`Firebase ${r.status}`);
  return d;
}
function muxAuth(){
  if(!MUX_TOKEN_ID||!MUX_TOKEN_SECRET) throw new Error("Mux credentials are missing in Render.");
  return Buffer.from(`${MUX_TOKEN_ID}:${MUX_TOKEN_SECRET}`).toString("base64");
}
async function mux(p,o={}){
  const r=await fetch("https://api.mux.com"+p,{...o,headers:{
    Authorization:`Basic ${muxAuth()}`,"Content-Type":"application/json",...(o.headers||{})
  }});
  const t=await r.text(); let d={}; try{d=t?JSON.parse(t):{}}catch{d={raw:t}}
  if(!r.ok) throw new Error(d?.error?.messages?.join(", ")||d?.error?.message||d?.message||t||`Mux ${r.status}`);
  return d;
}

app.get("/health",(_,res)=>res.json({ok:true,service:"Bryves TV API"}));

app.get("/api/public/status",async(_,res)=>{
  try{
    const c=await firebase("config")||{};
    res.json({success:true,live:c.live===true,status:c.status||"idle",playbackId:c.playbackId||null,title:c.title||"Bryves TV",description:c.description||"Welcome to Bryves TV."});
  }catch(e){res.status(500).json({success:false,error:e.message})}
});

app.get("/api/channel",auth,async(_,res)=>{
  try{res.json({success:true,config:await firebase("config")||{}})}
  catch(e){res.status(500).json({success:false,error:e.message})}
});

app.patch("/api/channel",auth,async(req,res)=>{
  try{
    await firebase("config","PATCH",{title:String(req.body?.title||"Bryves TV").slice(0,200),description:String(req.body?.description||"").slice(0,2000),updatedAt:Date.now()});
    res.json({success:true});
  }catch(e){res.status(500).json({success:false,error:e.message})}
});

app.post("/api/live-stream/create",auth,async(req,res)=>{
  try{
    const title=String(req.body?.title||"Bryves TV Live").slice(0,512);
    const r=await mux("/video/v1/live-streams",{method:"POST",body:JSON.stringify({
      playback_policies:["public"],latency_mode:"low",reconnect_window:60,
      new_asset_settings:{playback_policies:["public"]},meta:{title}
    })});
    const s=r.data, pb=s.playback_ids?.find(x=>x.policy==="public")?.id||s.playback_ids?.[0]?.id;
    if(!pb||!s.stream_key) throw new Error("Mux did not return Stream Key/Playback ID.");
    const c={title,description:String(req.body?.description||""),liveStreamId:s.id,playbackId:pb,streamKey:s.stream_key,
      playbackUrl:`https://stream.mux.com/${pb}.m3u8`,rtmpsUrl:"rtmps://global-live.mux.com:443/app",
      status:s.status||"idle",live:false,createdAt:Date.now()};
    await firebase("config","PUT",c);
    res.json({success:true,data:{id:s.id,playbackId:pb,streamKey:s.stream_key,status:s.status||"idle",playbackUrl:c.playbackUrl,rtmpsUrl:c.rtmpsUrl}});
  }catch(e){console.error(e);res.status(500).json({success:false,error:e.message})}
});

app.get("/api/live-stream/status",auth,async(_,res)=>{
  try{
    const c=await firebase("config")||{};
    if(!c.liveStreamId) return res.status(404).json({success:false,error:"No live stream created yet."});
    const r=await mux(`/video/v1/live-streams/${encodeURIComponent(c.liveStreamId)}`);
    const s=r.data,live=s.status==="active";
    await firebase("config","PATCH",{status:s.status,live,checkedAt:Date.now()});
    res.json({success:true,live,status:s.status,liveStreamId:s.id,playbackId:c.playbackId,streamKey:c.streamKey});
  }catch(e){res.status(500).json({success:false,error:e.message})}
});

app.listen(PORT,()=>console.log(`Bryves TV API on ${PORT}`));
