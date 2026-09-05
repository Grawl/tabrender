#!/usr/bin/env bash
# Fetch all free assets used by the renderer into ./assets (~2.5 GB).
set -euo pipefail
cd "$(dirname "$0")"
A=assets; mkdir -p $A/dl $A/sfz $A/amps $A/ir
py() { python3 "$@"; }
command -v gdown >/dev/null || pip install --user gdown
# Unreal Instruments SFZ libraries (free, DI): Standard Guitar (6-string) and Metal GTX (7-string)
[ -d "$A/sfz/UI_Standard_Guitar" ] || { gdown 1uoV7icZV1_IjiOGKM7Wm5_K5UkF41Fm3 -O $A/dl/standard_guitar.rar; (cd $A/sfz && bsdtar -xf ../dl/standard_guitar.rar || true); }
[ -d "$A/sfz/UI_METAL-GTX" ] || { gdown 1FurY3_x_tog_56irX1VDNyRCUt5JD7bO -O $A/dl/metal_gtx.rar; (cd $A/sfz && bsdtar -xf ../dl/metal_gtx.rar || true); }
# GuitarML ToneLibrary Proteus amp captures (GPL-3.0)
for f in 6505Plus_Red_DirectOut MesaMiniRec_HighGain_DirectOut RevvG4_Red_DriveKnob Splawn_OD_FractalFM3_HighGain PrincetonAmp_Clean; do
  [ -f $A/amps/$f.json ] || curl -sSL -o $A/amps/$f.json "https://raw.githubusercontent.com/GuitarML/ToneLibrary/main/Proteus/$f.json"
done
# Salamander Drumkit (CC-BY-SA-3.0), SFZ, GM mapped
[ -f $A/drums/ALL.sfz ] || { mkdir -p $A/drums; curl -sSL -o $A/dl/salamanderDrumkit.tar.bz2 "https://archive.org/download/SalamanderDrumkit/salamanderDrumkit.tar.bz2"; tar xjf $A/dl/salamanderDrumkit.tar.bz2 -C $A/drums; }
# Cabinet IRs
[ -f $A/ir/proteus_default_ir.wav ] || curl -sSL -o $A/ir/proteus_default_ir.wav "https://raw.githubusercontent.com/GuitarML/Proteus/main/resources/default_ir.wav"
[ -f $A/ir/spiceamp_4x12.wav ] || curl -sSL -o $A/ir/spiceamp_4x12.wav "https://raw.githubusercontent.com/olegkapitonov/spiceAmp/master/Models/Cabinets/4x12_impulse.wav"
# Drums/bass/keys use ../soundfont/FluidR3_GM_mono.sf2 (mounted at /soundfont in compose).
echo "assets ready"
