const sharp = require('sharp')
const path = require('path')

const sizes = [72, 96, 128, 144, 152, 192, 384, 512]
const input = path.join(__dirname, '../public/logo.png')
const outputDir = path.join(__dirname, '../public/icons')

async function generateIcons() {
  console.log('Génération des icônes PWA...')
  for (const size of sizes) {
    const output = path.join(outputDir, `icon-${size}x${size}.png`)
    await sharp(input)
      .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .png()
      .toFile(output)
    console.log(`✓ icon-${size}x${size}.png`)
  }
  // Apple touch icon
  await sharp(input)
    .resize(180, 180, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(path.join(__dirname, '../public/icons/apple-touch-icon.png'))
  console.log('✓ apple-touch-icon.png')

  // Favicon
  await sharp(input)
    .resize(32, 32, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(path.join(__dirname, '../public/favicon.png'))
  console.log('✓ favicon.png')

  console.log('\n✅ Toutes les icônes générées dans public/icons/')
}

generateIcons().catch(console.error)
