export const MIX_DEFAULTS = { music: 60, hits: 150 };

export function duckMusic(parameter, when) {
  parameter.cancelScheduledValues(when);
  parameter.setTargetAtTime(0.7, when, 0.003);
  parameter.setTargetAtTime(1, when + 0.05, 0.025);
}

export function createHitBuffer(context, note) {
  const blue = note === '2' || note === '4';
  const duration = blue ? 0.16 : 0.25;
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const samples = buffer.getChannelData(0);
  let seed = 1937, previousNoise = 0, peak = 0;
  for (let index = 0; index < samples.length; index++) {
    const time = index / context.sampleRate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1;
    const attack = Math.min(1, time / 0.0015);
    const body = blue
      ? (Math.sin(2 * Math.PI * 920 * time) * 0.5 + Math.sin(2 * Math.PI * 1560 * time) * 0.3 + Math.sin(2 * Math.PI * 2380 * time) * 0.2) * Math.exp(-time * 38)
      : (Math.sin(2 * Math.PI * 165 * time) * 0.7 + Math.sin(2 * Math.PI * 285 * time) * 0.35 + Math.sin(2 * Math.PI * 425 * time) * 0.2) * Math.exp(-time * 22);
    const impact = (blue ? noise - previousNoise * 0.85 : noise) * (blue ? 0.32 : 0.24) * Math.exp(-time * (blue ? 70 : 110));
    samples[index] = (body + impact) * attack * Math.min(1, (duration - time) / 0.01);
    previousNoise = noise; peak = Math.max(peak, Math.abs(samples[index]));
  }
  for (let index = 0; index < samples.length; index++) samples[index] *= 0.9 / peak;
  return buffer;
}