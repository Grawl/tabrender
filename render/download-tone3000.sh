#!/usr/bin/env bash
# Fetch NAM captures and IRs from tone3000.com with the account's Secret Key stored in ./.tone3000-key.
# Model ids come from https://www.tone3000.com/api/v1/models?tone_id=<tone id>.
set -euo pipefail
cd "$(dirname "$0")"
K=$(cat .tone3000-key)
A=assets; mkdir -p $A/amps/nam $A/ir/t3k
dl() { # <model id> <target path>
  [ -f "$2" ] && return 0
  url=$(curl -sf -H "Authorization: Bearer $K" "https://www.tone3000.com/api/v1/models/$1" | python3 -c 'import json,sys; print(json.load(sys.stdin)["model_url"])')
  curl -sfL -H "Authorization: Bearer $K" -o "$2" "$url" && echo "$2"
}
# tone 32868 Full Rig Peavey 5150 + Mesa 4x12 (jpisoutoftune)
dl 153616 $A/amps/nam/5150_MXR_MesaOS_SM57_fullrig.nam
dl 153618 $A/amps/nam/5150_noboost_MesaOS_SM57_fullrig.nam
# tone 69206 Mesa Dual Rectifier MW Red Modern full rig
dl 557166 $A/amps/nam/MesaDualRec_MW_RedModern_g6_SM57_fullrig.nam
# tone 58798 1992 Peavey 5150 Block Letter | Mesa OS 412 full rig
dl 343662 $A/amps/nam/5150_BlockLetter_MesaOS_fullrig.nam
# tone 1621 Fortin Meshuggah
dl 81545 $A/amps/nam/Fortin_Meshuggah_1.nam
# tone 30247 OB1 5150 III full rigs
dl 132516 $A/amps/nam/EVH5150III_Red_Fortin33_fullrig.nam
# tone 1048 6505+ Rhythm from Hell
dl 82196 $A/amps/nam/6505plus_RhythmFromHell.nam
# IRs: tone 32550 Mesa OS 4x12 V30 SM57, tone 45023 Mesa 4x12 V30 SM57
dl 151410 $A/ir/t3k/MesaOS_V30_SM57_1.wav
dl 239466 $A/ir/t3k/Mesa4x12_V30_SM57_175in_VP28.wav
echo "tone3000 assets ready"
