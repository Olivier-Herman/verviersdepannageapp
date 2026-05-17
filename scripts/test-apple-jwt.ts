// scripts/test-apple-jwt.ts
// Teste la generation du JWT Apple Sign In + decode-le pour validation
import jwt from 'jsonwebtoken'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const teamId     = process.env.APPLE_TEAM_ID
const clientId   = process.env.APPLE_ID
const keyId      = process.env.APPLE_KEY_ID
const privateKey = process.env.APPLE_PRIVATE_KEY

console.log('=== ENV VARS PRESENTES ? ===')
console.log('APPLE_TEAM_ID  :', teamId ? `OK (${teamId})` : '❌ MANQUANT')
console.log('APPLE_ID       :', clientId ? `OK (${clientId})` : '❌ MANQUANT')
console.log('APPLE_KEY_ID   :', keyId ? `OK (${keyId})` : '❌ MANQUANT')
console.log('APPLE_PRIVATE_KEY :', privateKey ? `OK (${privateKey.length} chars)` : '❌ MANQUANT')

if (!teamId || !clientId || !keyId || !privateKey) {
  console.log('\n❌ Une env var manque LOCALEMENT. Verifie ton .env.local')
  process.exit(1)
}

console.log('\n=== FORMAT CLE PRIVEE ===')
console.log('Premiers 50 chars :', JSON.stringify(privateKey.slice(0, 50)))
console.log('Derniers 50 chars :', JSON.stringify(privateKey.slice(-50)))
console.log('Contient BEGIN PRIVATE KEY :', privateKey.includes('BEGIN PRIVATE KEY'))
console.log('Contient END PRIVATE KEY   :', privateKey.includes('END PRIVATE KEY'))
console.log('Contient \\n echappes      :', privateKey.includes('\\n'))
console.log('Contient sauts ligne reels :', privateKey.includes('\n'))

console.log('\n=== TENTATIVE SIGNATURE JWT ===')
try {
  const token = jwt.sign({}, privateKey, {
    algorithm: 'ES256',
    keyid:     keyId,
    issuer:    teamId,
    audience:  'https://appleid.apple.com',
    subject:   clientId,
    expiresIn: '180d',
  })
  console.log('✅ JWT genere avec succes')
  console.log('Longueur :', token.length, 'chars')
  console.log('Header :', JSON.parse(Buffer.from(token.split('.')[0], 'base64').toString()))
  console.log('Payload :', JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()))
} catch (e: any) {
  console.error('❌ Erreur signature JWT :', e.message)
  if (e.message.includes('PEM') || e.message.includes('encoded')) {
    console.error('\n💡 PROBABLE PROBLEME : format de la cle.')
    console.error('   La cle doit etre au format PEM avec sauts de ligne reels.')
    console.error('   Sur Vercel : verifie que tu as colle le contenu BRUT du .p8')
    console.error('   (avec les vrais sauts de ligne, pas des \\n echappes)')
  }
}
