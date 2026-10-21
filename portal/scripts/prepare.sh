#!/usr/bin/env bash
# Prépare ce que le dépôt ne contient pas, avant `gradle assembleRelease` :
#  - l'AAR de sherpa-onnx (reconnaissance vocale sur l'appareil) ;
#  - le modèle français de reconnaissance en continu (≈ 70 Mo) ;
#  - la goutte gomme autonome du site (site/media/ondine-gomme.js).
# Lancé par .github/workflows/portal-apk.yml ; marche aussi en local (bash, curl, tar).
set -euo pipefail
cd "$(dirname "$0")/.."

SHERPA_VERSION="1.13.8"
MODEL="sherpa-onnx-streaming-zipformer-fr-2023-04-14"
ASSETS="app/src/main/assets"

mkdir -p app/libs
if [ ! -f app/libs/sherpa-onnx.aar ]; then
  curl -fSL -o app/libs/sherpa-onnx.aar \
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/v${SHERPA_VERSION}/sherpa-onnx-${SHERPA_VERSION}.aar"
fi

if [ ! -d "$ASSETS/$MODEL" ]; then
  tmp="$(mktemp -d)"
  curl -fSL -o "$tmp/model.tar.bz2" \
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL}.tar.bz2"
  tar xjf "$tmp/model.tar.bz2" -C "$tmp"
  mkdir -p "$ASSETS/$MODEL"
  # Seulement ce que lit Ears.kt : encodeur int8, décodeur et joint en float.
  for f in encoder-epoch-29-avg-9-with-averaged-model.int8.onnx \
           decoder-epoch-29-avg-9-with-averaged-model.onnx \
           joiner-epoch-29-avg-9-with-averaged-model.onnx \
           tokens.txt; do
    cp "$tmp/$MODEL/$f" "$ASSETS/$MODEL/$f"
  done
  rm -rf "$tmp"
fi

cp ../site/media/ondine-gomme.js "$ASSETS/face/ondine-gomme.js"
du -sh app/libs/sherpa-onnx.aar "$ASSETS/$MODEL"
