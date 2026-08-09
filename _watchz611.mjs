import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} })
let mid=null
{ const {data}=await sb.from('incoming_missions').select('id').eq('mission_number',10105233).maybeSingle(); mid=data?.id }
let last=new Date().toISOString()
for(let i=0;i<240;i++){
  const { data:logs } = await sb.from('mission_logs').select('created_at,action,notes').eq('mission_id',mid).gt('created_at',last).order('created_at')
  const sig=(logs||[]).filter(l=>['change_type','completed','park','touring_closed','request_relivraison','touring_vr_captured','convert_to_rem_rel'].includes(l.action))
  if(sig.length){ for(const l of sig) console.log('CLÔTURE/TRANSFO #10105233:',l.created_at,l.action,'::',(l.notes||'').slice(0,80)); process.exit(0) }
  if(logs&&logs.length) last=logs[logs.length-1].created_at
  await new Promise(s=>setTimeout(s,30000))
}
console.log('fin surveillance Z611PD')
