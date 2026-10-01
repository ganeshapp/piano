// Local synthesized piano: no remote soundfont, sample download, or analytics.
export class PianoAudio {
  context: AudioContext | null = null;
  enabled = true;
  private voices = new Map<number, { gain: GainNode; osc: OscillatorNode }>();
  private all = new Set<{ gain: GainNode; osc: OscillatorNode }>();
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
    gain.gain.linearRampToValueAtTime(0.12 * (velocity / 127), when + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.015, when + 0.8);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 9);
    osc.start(when);
    const voice = { gain, osc };
    osc.onended = () => this.all.delete(voice);
    osc.stop(when + 10);
    this.voices.set(pitch, voice);
    this.all.add(voice);
  }
  off(pitch: number, when = this.now) {
    const voice = this.voices.get(pitch);
    if (!voice || !this.context) return;
    voice.gain.gain.cancelAndHoldAtTime(Math.max(when, this.now));
    voice.gain.gain.setTargetAtTime(0.00001, Math.max(when, this.now), 0.035);
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
