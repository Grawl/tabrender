// AudioWorkletProcessor for range/loop playback of a pre-decoded PCM buffer.
//
// At rate 1 this plays the buffer back sample-for-sample, with an equal-power crossfade at the
// loop seam so range looping is gapless. Below rate 0.999 it switches to WSOLA time-stretching so
// slowed-down playback preserves pitch while still looping gapless through the same source range.
// The WSOLA sequence/overlap/seek window sizes (ms) are tunable at runtime via a "tune" message
// (see loop-audio.js's `?stretch=seq,ovl,seek` URL param and `window.__loopAudio.tune`).
function isValidStretch(seqMs, ovlMs, seekMs) {
  return (
    Number.isFinite(seqMs) &&
    Number.isFinite(ovlMs) &&
    Number.isFinite(seekMs) &&
    seqMs >= 10 &&
    seqMs <= 100 &&
    ovlMs >= 2 &&
    ovlMs <= 40 &&
    ovlMs < seqMs / 2 &&
    seekMs >= 1 &&
    seekMs <= 30
  )
}

class LoopAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.chL = null
    this.chR = null
    this.sampleRate = 0
    this.playing = false
    this.rate = 1
    this.pos = 0
    this.L0 = 0
    this.L1 = 0
    this.looping = false
    this.processCount = 0

    // Loop-seam crossfade (rate === 1 path).
    this.seamFrames = 0
    this.inSeam = false
    this.seamIndex = 0

    // WSOLA time-stretching (rate < 0.999 path).
    this.seqMs = 40
    this.ovlMs = 12
    this.seekMs = 8
    this.seqFrames = 0
    this.ovlFrames = 0
    this.seekFrames = 0
    this.analysisHop = 0
    this.sourcePointer = 0
    this.segmentStartPointer = 0
    this.framesSinceSegmentStart = 0
    this.tailValid = false
    this.tailLeft = null
    this.tailRight = null
    this.tailMono = null
    this.fifoLeft = null
    this.fifoRight = null
    this.fifoCapacity = 0
    this.fifoReadIndex = 0
    this.fifoWriteIndex = 0
    this.fifoCount = 0

    this.port.onmessage = (event) => {
      const { data } = event
      switch (data.type) {
        case "buffer":
          this.chL = data.chL
          this.chR = data.chR
          this.sampleRate = data.sampleRate
          this.seamFrames = Math.round(0.003 * this.sampleRate)
          this.pos = 0
          if (this.L1 === 0 && this.chL.length > 0) this.L1 = this.chL.length
          this.applyStretchParams()
          break
        case "play":
          this.playing = true
          break
        case "pause":
          this.playing = false
          break
        case "seek":
          this.pos = data.frame
          this.inSeam = false
          this.resetStretcher(data.frame)
          break
        case "rate":
          this.rate = data.rate
          this.analysisHop = this.seqFrames * this.rate
          this.tailValid = false
          this.fifoReadIndex = 0
          this.fifoWriteIndex = 0
          this.fifoCount = 0
          break
        case "range":
          this.L0 = data.L0
          this.L1 = data.L1
          this.looping = data.looping
          this.inSeam = false
          break
        case "tune": {
          if (!isValidStretch(data.seq, data.ovl, data.seek)) break
          this.seqMs = data.seq
          this.ovlMs = data.ovl
          this.seekMs = data.seek
          this.applyStretchParams()
          break
        }
      }
    }
  }

  resetStretcher(anchorFrame) {
    this.tailValid = false
    this.fifoReadIndex = 0
    this.fifoWriteIndex = 0
    this.fifoCount = 0
    this.sourcePointer = anchorFrame
    this.segmentStartPointer = anchorFrame
    this.framesSinceSegmentStart = 0
  }

  applyStretchParams() {
    if (this.sampleRate === 0) return
    this.seqFrames = Math.round((this.seqMs / 1000) * this.sampleRate)
    this.ovlFrames = Math.round((this.ovlMs / 1000) * this.sampleRate)
    this.seekFrames = Math.round((this.seekMs / 1000) * this.sampleRate)
    this.analysisHop = this.seqFrames * this.rate
    this.tailLeft = new Float32Array(this.ovlFrames)
    this.tailRight = new Float32Array(this.ovlFrames)
    this.tailMono = new Float32Array(this.ovlFrames)
    this.fifoCapacity = this.seqFrames * 3
    this.fifoLeft = new Float32Array(this.fifoCapacity)
    this.fifoRight = new Float32Array(this.fifoCapacity)
    this.resetStretcher(this.pos)
  }

  srcAt(frameIndex, ch) {
    if (!this.chL) return 0
    const buffer = ch === 0 ? this.chL : this.chR
    const length = buffer.length
    if (this.looping) {
      const len = this.L1 - this.L0
      if (len <= 0) return 0
      const wrapped = this.L0 + ((((frameIndex - this.L0) % len) + len) % len)
      return buffer[wrapped] / 32768
    }
    const clamped = Math.max(0, Math.min(length - 1, frameIndex))
    return buffer[clamped] / 32768
  }

  // Non-wrapping, non-clamping sample read. Callers must have already proven the index is in
  // bounds; never call this speculatively.
  rawAt(frameIndex, ch) {
    const buffer = ch === 0 ? this.chL : this.chR
    return buffer[frameIndex] / 32768
  }

  pushFifo(sampleLeft, sampleRight) {
    this.fifoLeft[this.fifoWriteIndex] = sampleLeft
    this.fifoRight[this.fifoWriteIndex] = sampleRight
    this.fifoWriteIndex = (this.fifoWriteIndex + 1) % this.fifoCapacity
    this.fifoCount++
  }

  captureTail(startIndex) {
    for (let index = 0; index < this.ovlFrames; index++) {
      this.tailLeft[index] = this.srcAt(startIndex + index, 0)
      this.tailRight[index] = this.srcAt(startIndex + index, 1)
      this.tailMono[index] = (this.tailLeft[index] + this.tailRight[index]) / 2
    }
  }

  correlationScore(base, offset) {
    let numerator = 0
    let denominator = 0
    for (let index = 0; index < this.ovlFrames; index++) {
      const candidate =
        (this.srcAt(base + offset + index, 0) +
          this.srcAt(base + offset + index, 1)) /
        2
      numerator += this.tailMono[index] * candidate
      denominator += candidate * candidate
    }
    return numerator / Math.sqrt(denominator + 1e-9)
  }

  searchBestOffset(base) {
    let bestOffset = 0
    let bestScore = -Infinity
    for (
      let offset = -this.seekFrames;
      offset <= this.seekFrames;
      offset += 4
    ) {
      const score = this.correlationScore(base, offset)
      if (score > bestScore) {
        bestScore = score
        bestOffset = offset
      }
    }
    const coarseBest = bestOffset
    for (let offset = coarseBest - 3; offset <= coarseBest + 3; offset++) {
      if (offset < -this.seekFrames || offset > this.seekFrames) continue
      const score = this.correlationScore(base, offset)
      if (score > bestScore) {
        bestScore = score
        bestOffset = offset
      }
    }
    return bestOffset
  }

  // Appends exactly `seqFrames` frames to the FIFO.
  runWsolaIteration() {
    const base = Math.round(this.sourcePointer)
    if (!this.tailValid) {
      for (let index = 0; index < this.seqFrames; index++) {
        this.pushFifo(this.srcAt(base + index, 0), this.srcAt(base + index, 1))
      }
      this.captureTail(base + this.seqFrames)
      this.tailValid = true
    } else {
      const bestOffset = this.searchBestOffset(base)
      for (let index = 0; index < this.ovlFrames; index++) {
        const weight = 0.5 - 0.5 * Math.cos((Math.PI * index) / this.ovlFrames)
        const sourceIndex = base + bestOffset + index
        const candidateLeft = this.srcAt(sourceIndex, 0)
        const candidateRight = this.srcAt(sourceIndex, 1)
        this.pushFifo(
          this.tailLeft[index] * (1 - weight) + candidateLeft * weight,
          this.tailRight[index] * (1 - weight) + candidateRight * weight,
        )
      }
      for (let index = 0; index < this.seqFrames - this.ovlFrames; index++) {
        const sourceIndex = base + bestOffset + this.ovlFrames + index
        this.pushFifo(this.srcAt(sourceIndex, 0), this.srcAt(sourceIndex, 1))
      }
      this.captureTail(base + bestOffset + this.seqFrames)
    }
    this.segmentStartPointer = this.sourcePointer
    this.framesSinceSegmentStart = 0
    this.sourcePointer += this.analysisHop
  }

  wrapPosition(position) {
    if (!this.looping) return position
    const length = this.L1 - this.L0
    if (length <= 0) return position
    return this.L0 + ((((position - this.L0) % length) + length) % length)
  }

  fillWsolaOutput(left, right, blockSize) {
    while (this.fifoCount < blockSize && this.playing) {
      this.runWsolaIteration()
    }
    for (let frame = 0; frame < blockSize; frame++) {
      if (!this.playing || this.fifoCount === 0) {
        left[frame] = 0
        right[frame] = 0
        continue
      }
      left[frame] = this.fifoLeft[this.fifoReadIndex]
      right[frame] = this.fifoRight[this.fifoReadIndex]
      this.fifoReadIndex = (this.fifoReadIndex + 1) % this.fifoCapacity
      this.fifoCount--
      this.framesSinceSegmentStart++
      this.pos = this.wrapPosition(
        this.segmentStartPointer + this.framesSinceSegmentStart * this.rate,
      )
      if (!this.looping && this.L1 > 0 && this.pos >= this.L1) {
        this.port.postMessage({ type: "ended", frame: this.L1 })
        this.playing = false
        this.fifoReadIndex = 0
        this.fifoWriteIndex = 0
        this.fifoCount = 0
      }
    }
  }

  process(inputs, outputs) {
    const output = outputs[0]
    const left = output[0]
    const right = output[1]

    if (!this.chL || !this.playing) {
      left.fill(0)
      right.fill(0)
      return true
    }

    this.processCount++

    if (this.rate < 0.999) {
      this.fillWsolaOutput(left, right, left.length)
    } else {
      for (let frame = 0; frame < left.length; frame++) {
        if (!this.looping && this.L1 > 0 && this.pos >= this.L1) {
          this.port.postMessage({ type: "ended", frame: this.L1 })
          this.playing = false
          left.fill(0, frame)
          right.fill(0, frame)
          return true
        }

        if (this.looping && !this.inSeam && this.pos >= this.L1) {
          const seamEligible = this.L1 + this.seamFrames <= this.chL.length
          if (seamEligible) {
            this.inSeam = true
            this.seamIndex = 0
          } else {
            this.pos = this.L0
          }
        }

        if (this.inSeam) {
          const weight =
            0.5 - 0.5 * Math.cos((Math.PI * this.seamIndex) / this.seamFrames)
          left[frame] =
            this.rawAt(this.L1 + this.seamIndex, 0) * (1 - weight) +
            this.rawAt(this.L0 + this.seamIndex, 0) * weight
          right[frame] =
            this.rawAt(this.L1 + this.seamIndex, 1) * (1 - weight) +
            this.rawAt(this.L0 + this.seamIndex, 1) * weight
          this.seamIndex++
          if (this.seamIndex >= this.seamFrames) {
            this.inSeam = false
            this.pos = this.L0 + this.seamFrames
          }
          continue
        }

        const index = Math.floor(this.pos)
        left[frame] = this.srcAt(index, 0)
        right[frame] = this.srcAt(index, 1)
        this.pos++
      }
    }

    if (this.playing && this.processCount % 8 === 0) {
      this.port.postMessage({ type: "pos", frame: this.pos })
    }

    return true
  }
}

registerProcessor("loop-audio", LoopAudioProcessor)
