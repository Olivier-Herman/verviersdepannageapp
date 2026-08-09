import { loginVab, listVabMissions, dumpVabActions } from './src/lib/vab/scraper.ts'
const sess=await loginVab()
const list=await listVabMissions(sess)
console.log('missions:',list.missions.length)
for(const m of list.missions){
  const a=await dumpVabActions(sess,m.detailHref).catch(()=>({buttonTexts:[]}))
  console.log(' ',m.detailHref,'->',JSON.stringify((a.buttonTexts||[]).filter(b=>!/Néerlandais|Français|Allemand|Anglais|nouvelles|Paramètres|Preuve|Contrat|Email|Retourner/.test(b))))
}
