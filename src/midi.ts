import * as vscode from 'vscode';
import * as fs from 'fs';
import { logger, LogLevel, stripFileExtension } from './util';

const JZZ = require('jzz');
require('jzz-midi-smf')(JZZ);

console.log(JZZ().info());

let timeout: NodeJS.Timer | undefined = undefined;
let statusBarItems: Record<string, vscode.StatusBarItem> = {};

const midiout = JZZ().openMidiOut();

type MIDIStateType = {
    player: any | undefined,
    playing: boolean,
    paused: boolean,
    currMidiFilePath: string | undefined,
};

const initialMIDIState: MIDIStateType = {
    player: undefined,
    playing: false,
    paused: false,
    currMidiFilePath: undefined,
};

let MIDIState: MIDIStateType = initialMIDIState;

const getMidiFilePathFromActiveTextEditor = () => {
    const activeTextEditor = vscode.window.activeTextEditor;
    if (!activeTextEditor) {
        throw new Error(`No active text editor open`);
    }
    const midiFileName = stripFileExtension(activeTextEditor.document.uri.fsPath) + `.mid`;
    console.log(midiFileName);
    return midiFileName;
};

/// loads midi file based on current active text editor into MIDIState.player
const loadMIDI = () => {
    try {
        const midiFileName = getMidiFilePathFromActiveTextEditor();

        const data = fs.readFileSync(midiFileName, `binary`);
        const smf = JZZ.MIDI.SMF(data);
        MIDIState.currMidiFilePath = midiFileName;
        MIDIState.player = smf.player();
        MIDIState.player.connect(midiout);
    }
    catch (err) {
        logger(err.message, LogLevel.error, true);
        throw new Error(`Cannot find MIDI file to play - make sure you are outputting a MIDI file and you have an active \`lilypond\` text document.`)
    }
};

const pollMIDIStatus = () => {
    const msToMMSS = (ms: number) => {
        const seconds = Math.round(ms / 1000);
        const mm = Math.round(seconds / 60).toString();
        const ss = Math.round(seconds % 60).toString().padStart(2, `0`);

        return `${mm}:${ss}`;
    };

    const duration = MIDIState.player.durationMS();
    const position = MIDIState.player.positionMS();

    /// need to be called with a 500 ms timeout otherwise it will fail!
    /// this is because position gets set to 0 when the midi finishes playing.
    if (position === 0 && (MIDIState.player && MIDIState.playing || MIDIState.paused)) {
        stopMIDI();
    }
    else {
        const durationMMSS = msToMMSS(duration);
        const positionMMSS = msToMMSS(position);
        vscode.window.setStatusBarMessage(`Playing \`${MIDIState.currMidiFilePath}\`: ${positionMMSS}\/${durationMMSS}`);
        timeout = setTimeout(pollMIDIStatus, 100);
    }
};

export const playMIDI = () => {
    try {
        resetMIDI();
        loadMIDI();

        if (MIDIState.player) {
            MIDIState.player.play();
            MIDIState.playing = true;
            timeout = setTimeout(pollMIDIStatus, 100);
        }
        else {
            throw new Error(`Unable to load MIDI player`);
        }
    }
    catch (err) {
        logger(err.message, LogLevel.error, false);
    }
    updateMIDIStatusBarItem();
};

export const stopMIDI = () => {
    try {
        if (MIDIState.player && MIDIState.playing || MIDIState.paused) {
            MIDIState.player.stop();
            MIDIState.playing = false;
            MIDIState.paused = false;
            vscode.window.setStatusBarMessage(``);
            if (timeout) {
                clearTimeout(timeout);
            }
        }
        else {
            throw new Error(`No active MIDI file to stop`);
        }
    }
    catch (err) {
        logger(err.message, LogLevel.error, false);
    }
    updateMIDIStatusBarItem();
};

export const pauseMIDI = () => {
    try {
        if (MIDIState.player && MIDIState.playing && !MIDIState.paused) {
            MIDIState.player.pause();
            MIDIState.paused = true;
            MIDIState.playing = false;
            vscode.window.setStatusBarMessage(`Paused MIDI: ${MIDIState.currMidiFilePath}`);
            if (timeout) {
                clearTimeout(timeout);
            }
        }
        else {
            throw new Error(`No active MIDI file to pause`);
        }
    }
    catch (err) {
        logger(err.message, LogLevel.error, false);
    }
    updateMIDIStatusBarItem();
};

export const resumeMIDI = () => {
    try {
        if (MIDIState.player && MIDIState.paused && !MIDIState.playing) {
            MIDIState.player.resume();
            MIDIState.paused = false;
            MIDIState.playing = true;
            timeout = setTimeout(pollMIDIStatus, 100);
        }
        else {
            playMIDI(); // play from beginning
        }
    }
    catch (err) {
        logger(err.message, LogLevel.error, false);
    }
    updateMIDIStatusBarItem();
};

export const resetMIDI = () => {
    if (MIDIState.player && MIDIState.playing || MIDIState.paused) {
        stopMIDI();
    }
    if (timeout) {
        clearTimeout(timeout);
    }
    MIDIState = initialMIDIState;
    updateMIDIStatusBarItem();
};

export const initMIDIStatusBarItems = () => {
    {
        let playBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        playBtn.command = `extension.resumeMIDI`;
        playBtn.text = `$(play) Play MIDI`;
        playBtn.tooltip = `Play MIDI output file (Resumes if paused)`;
        statusBarItems.play = playBtn;
    }
    {
        let pauseBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
        pauseBtn.command = `extension.pauseMIDI`;
        pauseBtn.text = `$(debug-pause) Pause MIDI`;
        pauseBtn.tooltip = `Pause MIDI playback`;
        statusBarItems.pause = pauseBtn;
    }
    {
        let stopBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
        stopBtn.command = `extension.stopMIDI`;
        stopBtn.text = `$(debug-stop) Stop MIDI`;
        stopBtn.tooltip = `Stop MIDI playback`;
        statusBarItems.stop = stopBtn;
    }
    updateMIDIStatusBarItem();
};

/// update status bar item for midi playback
const updateMIDIStatusBarItem = () => {
    if (MIDIState.playing) {
        statusBarItems.play.hide();
        statusBarItems.pause.show();
        statusBarItems.stop.show();
    }
    else {
        statusBarItems.play.show();
        statusBarItems.pause.hide();
        statusBarItems.stop.hide();
    }
};