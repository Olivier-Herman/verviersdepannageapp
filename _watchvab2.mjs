import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')]}))
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} })
const MID='ba0b4e7a-c98e-4978-a660-3a8e703ecf9c'
let lastSeen=new Date().toISOString()
for(let i=0;i<360;i++){ // ~3h
  // nouveaux logs significatifs (assignation, en route, sur place, transformation, clôture)
  const { data:logs } = await sb.from('mission_logs').select('created_at,action,notes').eq('mission_id',MID).gt('created_at',lastSeen).order('created_at')
  const sig=(logs||[]).filter(l=>['assigned','accept','on_way','on_site','completed','change_type','park','dispatched'].includes(l.action))
  if(sig.length){
    for(const l of sig) console.log('ÉVÉNEMENT VAB #10105232:',l.created_at,l.action,'::',(l.notes||'').slice(0,70))
    process.exit(0)
  }
  if(logs&&logs.length) lastSeen=logs[logs.length-1].created_at
  await new Promise(s=>setTimeout(s,30000))
}
console.log('fin surveillance (timeout ~3h)')
