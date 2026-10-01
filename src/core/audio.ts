interface Voice {
  gain: GainNode;
  osc: OscillatorNode;
  start: number;
  peak: number;
}

// Local synthesized piano: no remote soundfont, sample download, or analytics.
export class PianoAudio {
  context: AudioContext | null = null;
  enabled = true;
  private voices = new Map<number, Voice>();
  private all = new Set<Voice>();
  async init() {
    if (!this.context) this.context = new AudioContext();
    await this.context.resume();
  }
  get now() {
    return this.context?.currentTime ?? performance.now() / 1000;
  }
  on(pitch: number, when = this.now, velocity = 72) {
    if (!this.enabled || !this.context) return;
    this.off(pitch, when);
    const c = this.context,
      osc = c.createOscillator(),
      gain = c.createGain();
    const real = new Float32Array(12),
      imag = new Float32Array(12);
    [1, 0.5, 0.22, 0.12, 0.08, 0.055, 0.03, 0.02].forEach(
      (a, i) => (imag[i + 1] = a),
    );
    osc.setPeriodicWave(c.createPeriodicWave(real, imag));
    osc.frequency.value = 440 * 2 ** ((pitch - 69) / 12);
    osc.connect(gain);
    gain.connect(c.destination);
    gain.gain.setValueAtTime(0, when);
    const peak = 0.12 * (Math.max(1, Math.min(127, velocity)) / 127);
    gain.gain.linearRampToValueAtTime(peak, when + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.015, when + 0.8);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 9);
    osc.start(when);
    const voice = { gain, osc, start: when, peak };
    osc.onended = () => this.all.delete(voice);
    osc.stop(when + 10);
    this.voices.set(pitch, voice);
    this.all.add(voice);
  }
  off(pitch: number, when = this.now) {
    const voice = this.voices.get(pitch);
    if (!voice || !this.context) return;
    const time = Math.max(when, this.now),
      param = voice.gain.gain;
    if (typeof param.cancelAndHoldAtTime === "function") {
      param.cancelAndHoldAtTime(time);
    } else {
      // Removing a future ramp endpoint also removes the ramp leading to it.
      // Recreate its endpoint at release time using our known envelope, so
      // look-ahead releases neither jump in volume nor shorten held notes.
      param.cancelScheduledValues(time);
      const elapsed = time - voice.start;
      if (elapsed <= 0) param.setValueAtTime(0, time);
      else if (elapsed <= 0.006)
        param.linearRampToValueAtTime((voice.peak * elapsed) / 0.006, time);
      else if (elapsed <= 0.8)
        param.exponentialRampToValueAtTime(
          voice.peak * (0.015 / voice.peak) ** ((elapsed - 0.006) / 0.794),
          time,
        );
      else if (elapsed <= 9)
        param.exponentialRampToValueAtTime(
          0.015 * (0.0001 / 0.015) ** ((elapsed - 0.8) / 8.2),
          time,
        );
      else param.setValueAtTime(0.0001, time);
    }
    param.setTargetAtTime(0.00001, time, 0.035);
    try {
      voice.osc.stop(Math.max(when, this.now) + 0.18);
    } catch {
      /* already stopped */
    }
    this.voices.delete(pitch);
  }
  stop() {
    for (const v of this.all) {
      try {
        v.gain.gain.cancelScheduledValues(0);
        v.gain.gain.setValueAtTime(0, this.now);
        v.osc.stop();
      } catch {
        /* finished */
      }
    }
    this.voices.clear();
    this.all.clear();
  }
}
