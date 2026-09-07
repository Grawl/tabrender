// AudioWorkletProcessor for range/loop playback of a pre-decoded PCM buffer.
//
// This is the passthrough stage: it plays the buffer back at rate 1 only, reading one sample per
// output frame, with optional range looping. Variable-rate WSOLA time-stretching (for the tempo
// slider) is added in a later commit; the `rate` field is already accepted and stored here so that
// commit only has to change how `pos` advances, not the message protocol.
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

    this.port.onmessage = (event) => {
      const { data } = event
      switch (data.type) {
        case "buffer":
          this.chL = data.chL
          this.chR = data.chR
          this.sampleRate = data.sampleRate
          this.pos = 0
          if (this.L1 === 0 && this.chL.length > 0) this.L1 = this.chL.length
          break
        case "play":
          this.playing = true
          break
        case "pause":
          this.playing = false
          break
        case "seek":
          this.pos = data.frame
          break
        case "rate":
          this.rate = data.rate
          break
        case "range":
          this.L0 = data.L0
          this.L1 = data.L1
          this.looping = data.looping
          break
      }
    }
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

    for (let frame = 0; frame < left.length; frame++) {
      if (!this.looping && this.L1 > 0 && this.pos >= this.L1) {
        this.port.postMessage({ type: "ended", frame: this.L1 })
        this.playing = false
        left.fill(0, frame)
        right.fill(0, frame)
        return true
      }
      // TODO(loop-audio): rate !== 1 goes through WSOLA, added in a later commit
      const index = Math.floor(this.pos)
      left[frame] = this.srcAt(index, 0)
      right[frame] = this.srcAt(index, 1)
      this.pos++
    }

    if (this.playing && this.processCount % 8 === 0) {
      this.port.postMessage({ type: "pos", frame: this.pos })
    }

    return true
  }
}

registerProcessor("loop-audio", LoopAudioProcessor)
