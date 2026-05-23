#!/bin/bash
# Prepare les screenshots iPhone pour App Store Connect :
#   - Strip le canal alpha (sinon Apple rejette : "ni canaux alpha ni transparence")
#   - Garde la dimension native (pas de resize - ton iPhone 16/17 Pro Max = 1320x2868 = slot 6.9")
#
# Usage :
#   1. Mets toutes tes captures .png dans ~/Downloads/screenshots/
#   2. Lance : bash scripts/prepare-app-store-screenshots.sh ~/Downloads/screenshots
#   3. Recupere les fichiers nettoyes dans ~/Downloads/screenshots/clean/

SRC_DIR="${1:-$HOME/Downloads/screenshots}"
OUT_DIR="$SRC_DIR/clean"

if [ ! -d "$SRC_DIR" ]; then
  echo "❌ Dossier introuvable : $SRC_DIR"
  exit 1
fi

mkdir -p "$OUT_DIR"
TMP_DIR=$(mktemp -d)
echo "📁 Source : $SRC_DIR"
echo "📁 Sortie : $OUT_DIR"
echo ""

count=0
for src in "$SRC_DIR"/*.png "$SRC_DIR"/*.PNG; do
  [ -e "$src" ] || continue
  filename=$(basename "$src")
  base="${filename%.*}"
  out="$OUT_DIR/$base.png"

  # Strip alpha : conversion JPEG (sans alpha possible) puis re-export en PNG opaque
  sips -s format jpeg "$src" --out "$TMP_DIR/$base.jpg" >/dev/null 2>&1
  sips -s format png "$TMP_DIR/$base.jpg" --out "$out" >/dev/null 2>&1

  # Verification
  has_alpha=$(sips -g hasAlpha "$out" | tail -1 | awk '{print $2}')
  dims=$(sips -g pixelWidth -g pixelHeight "$out" | tail -2 | awk '{print $2}' | tr '\n' 'x' | sed 's/x$//')
  echo "  ✓ $filename → $base.png ($dims, alpha=$has_alpha)"
  count=$((count + 1))
done

rm -rf "$TMP_DIR"
echo ""
echo "✨ $count capture(s) preparees. Upload dans App Store Connect → slot 'iPhone Ecran de 6,9 pouces'."
