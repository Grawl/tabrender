// Usage: node gp2midi.mjs <in.gp> <out.mid> <out.json>
// Exports an SMF1 MIDI plus a JSON with track/channel mapping and per-note articulations
// (palm mute, dead note, let ring, harmonics) keyed by "channel:tick:pitch" — SMF cannot carry these.
import * as alphaTab from '@coderline/alphatab';
import fs from 'node:fs';

const [, , inFile, outMidi, outJson] = process.argv;
const data = new Uint8Array(fs.readFileSync(inFile));
const settings = new alphaTab.Settings();
const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(data, settings);
const midi = new alphaTab.midi.MidiFile();
const handler = new alphaTab.midi.AlphaSynthMidiFileHandler(midi, true);
new alphaTab.midi.MidiFileGenerator(score, settings, handler).generate();
fs.writeFileSync(outMidi, Buffer.from(midi.toBinary()));

const tracks = score.tracks.map((t) => ({
	index: t.index,
	name: t.name,
	program: t.playbackInfo.program,
	isPercussion: t.playbackInfo.isPercussion,
	primaryChannel: t.playbackInfo.primaryChannel,
	secondaryChannel: t.playbackInfo.secondaryChannel,
	volume: t.playbackInfo.volume,
	balance: t.playbackInfo.balance,
	tuning: t.staves[0]?.tuning ?? [],
	transpositionPitch: t.staves[0]?.transpositionPitch ?? 0,
}));

const articulations = {};
for (const t of score.tracks) {
	for (const staff of t.staves) {
		for (const bar of staff.bars) {
			for (const voice of bar.voices) {
				for (const beat of voice.beats) {
					for (const note of beat.notes) {
						const flags = [];
						if (note.isPalmMute) flags.push('pm');
						if (note.isDead) flags.push('dead');
						if (note.isLetRing) flags.push('ring');
						if (note.isGhost) flags.push('ghost');
						if (note.harmonicType) flags.push('harm');
						if (note.isStaccato) flags.push('stacc');
						if (note.vibrato) flags.push('vib');
						if (note.slideOutType || note.slideInType) flags.push('slide');
						if (note.isTieDestination) flags.push('tie');
						if (beat.tremoloSpeed !== null && beat.tremoloSpeed !== undefined) flags.push('trem');
						if (flags.length) {
							const key = `${t.index}:${beat.absolutePlaybackStart}:${note.realValue}`;
							articulations[key] = flags;
						}
					}
				}
			}
		}
	}
}
fs.writeFileSync(outJson, JSON.stringify({ title: score.title, artist: score.artist, tempo: score.tempo, tracks, articulations }, null, 1));
console.log('ok', tracks.length, 'tracks,', Object.keys(articulations).length, 'articulated notes');
