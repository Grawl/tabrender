"""Give the sonivox GM bank a usable volume envelope for guitars and basses.

The bundled sonivox.sf2 sets decay 0.07 s and sustain at -45 dB on its guitar and bass instruments, so every
note fades to silence right after the attack no matter how long it is written. The samples loop, so raising
the sustain level lets held notes ring for their notated length. Usage: sf2envelope.py in.sf2 out.sf2
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

PRESETS = set(range(24, 40))  # GM guitars 24-31 and basses 32-39, bank 0
GEN_DECAY, GEN_SUSTAIN, GEN_RELEASE = 36, 37, 38  # SF2 generator ids (volume envelope)
DECAY_TIMECENTS = 2000  # 2^(2000/1200) ~ 3.2 s
SUSTAIN_CENTIBELS = 60  # -6 dB below the peak while the key is held
RELEASE_TIMECENTS = -1200  # 0.5 s


def _chunks(data: bytes) -> dict[bytes, tuple[int, int]]:
    """Map sub-chunk id -> (offset, size) of the pdta LIST chunk contents."""
    found: dict[bytes, tuple[int, int]] = {}
    pos = 12
    while pos < len(data):
        cid = data[pos : pos + 4]
        size = struct.unpack("<I", data[pos + 4 : pos + 8])[0]
        if cid == b"LIST":
            sub = pos + 12
            end = pos + 8 + size
            while sub < end:
                sid = data[sub : sub + 4]
                ssize = struct.unpack("<I", data[sub + 4 : sub + 8])[0]
                found[sid] = (sub + 8, ssize)
                sub += 8 + ssize + (ssize & 1)
        pos += 8 + size + (size & 1)
    return found


def _records(data: bytes, chunk: tuple[int, int], fmt: str) -> list[tuple]:
    off, size = chunk
    step = struct.calcsize(fmt)
    return [struct.unpack(fmt, data[off + i : off + i + step]) for i in range(0, size, step)]


def patch(src: str, dst: str) -> int:
    data = bytearray(Path(src).read_bytes())
    chunks = _chunks(bytes(data))
    phdr = _records(data, chunks[b"phdr"], "<20sHHHIII")
    pbag = _records(data, chunks[b"pbag"], "<HH")
    pgen = _records(data, chunks[b"pgen"], "<HH")
    inst = _records(data, chunks[b"inst"], "<20sH")
    ibag = _records(data, chunks[b"ibag"], "<HH")
    igen_off = chunks[b"igen"][0]
    igen = _records(data, chunks[b"igen"], "<HH")
    instruments: set[int] = set()
    for index, preset in enumerate(phdr[:-1]):
        if preset[2] != 0 or preset[1] not in PRESETS:
            continue
        for bag in range(preset[3], phdr[index + 1][3]):
            for gen in range(pbag[bag][0], pbag[bag + 1][0]):
                if pgen[gen][0] == 41:
                    instruments.add(pgen[gen][1])
    patched = 0
    values = {GEN_DECAY: DECAY_TIMECENTS, GEN_SUSTAIN: SUSTAIN_CENTIBELS, GEN_RELEASE: RELEASE_TIMECENTS}
    for instrument in instruments:
        for zone in range(inst[instrument][1], inst[instrument + 1][1]):
            for gen in range(ibag[zone][0], ibag[zone + 1][0]):
                oper = igen[gen][0]
                if oper in values:
                    struct.pack_into("<Hh", data, igen_off + gen * 4, oper, values[oper])
                    patched += 1
    Path(dst).write_bytes(data)
    return patched


if __name__ == "__main__":
    print("patched generators:", patch(sys.argv[1], sys.argv[2]))
