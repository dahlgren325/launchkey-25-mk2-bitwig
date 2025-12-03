loadAPI(24);

var PLAY = 1;
var DRUM = 2;
var LAUNCH = 3;
var currentMode;
var padsNoteInput;
var cursorTrack;
var cursorDevice;
var transport;
var masterTrack;
var popupBrowser;
var drumDevice;
var drumPadBank;
var roundPads;
var drumPads;
var knobColors = [5, 9, 13, 17, 29, 41, 49, 57];
var knobColorsOff = [7, 11, 15, 19, 31, 43, 51, 59];
var remoteControls;
var deviceBank;
var isCursorDevice;
var trackBank;
var blink = false;
var blinkRate = 200;
var translationTableEnabled;
var translationTableDisabled;
var hardwareSurface;

// Remove this if you want to be able to use deprecated methods without causing script to stop.
// This is useful during development.
host.setShouldFailOnDeprecatedUse(true);

host.defineController("Novation", "Launchkey 25 Mk2", "0.1", "8222a545-5fab-4b3d-a97e-bd7617ee2e72", "Ronnie Dahlgren");

host.defineMidiPorts(2, 2);

if (host.platformIsWindows()) {
	host.addDeviceNameBasedDiscoveryPair(["Launchkey MK2 25", "MIDIIN2 (Launchkey MK2 25)"], ["Launchkey MK2 25", "MIDIOUT2 (Launchkey MK2 25)"]);
} else if (host.platformIsMac()) {
	// TODO: Set the correct names of the ports for auto detection on Mac OSX platform here
	// and uncomment this when port names are correct.
	// host.addDeviceNameBasedDiscoveryPair(["Input Port 0", "Input Port 1"], ["Output Port 0", "Output Port 1"]);
} else if (host.platformIsLinux()) {
	// TODO: Set the correct names of the ports for auto detection on Linux platform here
	// and uncomment this when port names are correct.
	// host.addDeviceNameBasedDiscoveryPair(["Input Port 0", "Input Port 1"], ["Output Port 0", "Output Port 1"]);
}

function init() {
	currentMode = PLAY;

	// Note off, note on, modulation, channel pressure, pitch bend
	host.getMidiInPort(0).createNoteInput("Keys", "8?????", "9?????", "B?01??"/*, "D0????"*/, "E?????");
	//host.getMidiInPort(0).setMidiCallback(onMidi0);
	var midiIn1 = host.getMidiInPort(1);
	midiIn1.setMidiCallback(onMidi1);
	//host.getMidiInPort(0).setSysexCallback(onSysex0);
	//host.getMidiInPort(1).setSysexCallback(onSysex1);
	translationTableEnabled = createDrumPadNoteTranslationTable(true);
	translationTableDisabled = createDrumPadNoteTranslationTable(false);
	padsNoteInput = midiIn1.createNoteInput("Pads", "8f6???", "9f6???", "8f7???", "9f7???");
	padsNoteInput.setKeyTranslationTable(currentMode == DRUM ? translationTableEnabled : translationTableDisabled);

	// Enable extended mode
	host.getMidiOutPort(1).sendMidi(0x9f, 0x0C, 0x7f);

	// Create various device controller objects
	cursorTrack = host.createCursorTrack(0, 0);
	cursorDevice = cursorTrack.createCursorDevice();
	transport = host.createTransport();
	masterTrack = host.createMasterTrack(0);
	popupBrowser = host.createPopupBrowser();
	drumDevice = cursorTrack.createCursorDevice("inst", "Drum Device", 0, CursorDeviceFollowMode.FIRST_INSTRUMENT);
	drumPadBank = drumDevice.createDrumPadBank(16);
	remoteControls = cursorDevice.createCursorRemoteControlsPage(8);
	deviceBank = cursorTrack.createDeviceBank(8);
	trackBank = host.createTrackBank(8, 0, 2);

	// Configuration
	remoteControls.setHardwareLayout(com.bitwig.extension.controller.api.HardwareControlType.KNOB, 8);

	// Mark interests
	cursorTrack.color().markInterested();
	cursorDevice.exists().markInterested();
	cursorTrack.playingNotes().markInterested();
	popupBrowser.exists().markInterested();
	remoteControls.pageCount().markInterested();
	remoteControls.selectedPageIndex().markInterested();
	deviceBank.itemCount().markInterested();
	for (var i = 0; i < 16; i++) {
		var drumPad = drumPadBank.getItemAt(i);
		drumPad.exists().markInterested();
		drumPad.color().markInterested();
	}
	for (var i = 0; i < 8; i++) {
		var parameter = remoteControls.getParameter(i);
		parameter.markInterested();
		parameter.setIndication(true);
	}
	roundPads = [new Led(0x68, 72, host.getMidiOutPort(1)), new Led(0x78, 21, host.getMidiOutPort(1))];
	drumPads = [];
	for (var i = 0; i < 16; i++) {
		drumPads[i] = new Led(getPadNumberExtended(i), 0, host.getMidiOutPort(1));
	}
	isCursorDevice = [];
	for (var i = 0; i < 8; i++) {
		var device = deviceBank.getDevice(i);
		device.exists().markInterested();
		isCursorDevice[i] = device.createEqualsValue(cursorDevice);
		isCursorDevice[i].markInterested();
	}
	for (var i = 0; i < 8; i++) {
		var track = trackBank.getItemAt(i);
		track.arm().markInterested();
	}
	for (var i = 0; i < 16; i++) {
		var column = i & 0x07;
		var row = i >> 3;
		var track = trackBank.getItemAt(column);
		var slot = track.clipLauncherSlotBank().getItemAt(row);
		slot.isPlaying().markInterested();
		slot.hasContent().markInterested();
		slot.isRecording().markInterested();
		slot.isRecordingQueued().markInterested();
		slot.isPlaybackQueued().markInterested();
		slot.isStopQueued().markInterested();
		slot.color().markInterested();
	}

	createHardware(midiIn1);

	blinkTimer();

	println("Launchkey 25 Mk2 initialized!");
}

function createHardware(midiIn1) {
	// Hardware
	hardwareSurface = host.createHardwareSurface();

	var masterVolumeSlider = hardwareSurface.createHardwareSlider("MASTER_VOLUME");
	masterVolumeSlider.setAdjustValueMatcher(midiIn1.createAbsoluteCCValueMatcher(0, 7));
	masterVolumeSlider.setBinding(masterTrack.volume());

	var previousTrackButton = hardwareSurface.createHardwareButton("PREVIOUS_TRACK_BUTTON");
	previousTrackButton.pressedAction().setActionMatcher(midiIn1.createCCActionMatcher(0xf, 0x66, 0x7f));
	previousTrackButton.pressedAction().setBinding(host.createCallbackAction(previousTrack, null));

	var nextTrackButton = hardwareSurface.createHardwareButton("NEXT_TRACK_BUTTON");
	nextTrackButton.pressedAction().setActionMatcher(midiIn1.createCCActionMatcher(0xf, 0x67, 0x7f));
	nextTrackButton.pressedAction().setBinding(host.createCallbackAction(nextTrack, null));

	var rewindButton = hardwareSurface.createHardwareButton("REWIND_BUTTON");
	rewindButton.pressedAction().setActionMatcher(midiIn1.createCCActionMatcher(0xf, 0x70, 0x7f));
	rewindButton.pressedAction().setBinding(host.createCallbackAction(previousScene, null));

	var forwardButton = hardwareSurface.createHardwareButton("FORWARD_BUTTON");
	forwardButton.pressedAction().setActionMatcher(midiIn1.createCCActionMatcher(0xf, 0x71, 0x7f));
	forwardButton.pressedAction().setBinding(host.createCallbackAction(nextScene, null));

	var stopButton = hardwareSurface.createHardwareButton("STOP_BUTTON");
	stopButton.pressedAction().setActionMatcher(midiIn1.createCCActionMatcher(0xf, 0x72, 0x7f));
	stopButton.pressedAction().setBinding(transport.stopAction());

	var playButton = hardwareSurface.createHardwareButton("PLAY_BUTTON");
	playButton.pressedAction().setActionMatcher(midiIn1.createCCActionMatcher(0xf, 0x73, 0x7f));
	playButton.pressedAction().setBinding(transport.playAction());

	var loopButton = hardwareSurface.createHardwareButton("LOOP_BUTTON");
	loopButton.pressedAction().setActionMatcher(midiIn1.createCCActionMatcher(0xf, 0x74, 0x7f));
	loopButton.pressedAction().setBinding(transport.isArrangerLoopEnabled().toggleAction());

	var recordButton = hardwareSurface.createHardwareButton("RECORD_BUTTON");
	recordButton.pressedAction().setActionMatcher(midiIn1.createCCActionMatcher(0xf, 0x75, 0x7f));
	recordButton.pressedAction().setBinding(transport.recordAction());

	var inControl1Button = hardwareSurface.createHardwareButton("INCONTROL_1");
	inControl1Button.pressedAction().setActionMatcher(midiIn1.createActionMatcher("status == 0x9f && data1 == 0x0d && data2 == 0"));
	inControl1Button.pressedAction().setBinding(host.createCallbackAction(setPlayMode, null));

	var inControl2Button = hardwareSurface.createHardwareButton("INCONTROL_2");
	inControl2Button.pressedAction().setActionMatcher(midiIn1.createActionMatcher("status == 0x9f && data1 == 0x0f && data2 == 0"));
	inControl2Button.pressedAction().setBinding(host.createCallbackAction(setDrumOrLaunchMode, null));

	var roundButton1 = hardwareSurface.createHardwareButton("ROUND_1");
	roundButton1.pressedAction().setActionMatcher(midiIn1.createActionMatcher("status == 0x9f && data1 == 0x68 && data2 == 0x7f"));
	roundButton1.pressedAction().setBinding(host.createCallbackAction(onRoundPad1, null));

	var roundButton2 = hardwareSurface.createHardwareButton("ROUND_2");
	roundButton2.pressedAction().setActionMatcher(midiIn1.createActionMatcher("status == 0x9f && data1 == 0x78 && data2 == 0x7f"));
	roundButton2.pressedAction().setBinding(host.createCallbackAction(onRoundPad2, null));

	var knob1 = hardwareSurface.createAbsoluteHardwareKnob("KNOB_1");
	knob1.setAdjustValueMatcher(midiIn1.createAbsoluteCCValueMatcher(0xf, 0x15));
	knob1.setBinding(remoteControls.getParameter(0));

	var knob2 = hardwareSurface.createAbsoluteHardwareKnob("KNOB_2");
	knob2.setAdjustValueMatcher(midiIn1.createAbsoluteCCValueMatcher(0xf, 0x16));
	knob2.setBinding(remoteControls.getParameter(1));

	var knob3 = hardwareSurface.createAbsoluteHardwareKnob("KNOB_3");
	knob3.setAdjustValueMatcher(midiIn1.createAbsoluteCCValueMatcher(0xf, 0x17));
	knob3.setBinding(remoteControls.getParameter(2));

	var knob4 = hardwareSurface.createAbsoluteHardwareKnob("KNOB_4");
	knob4.setAdjustValueMatcher(midiIn1.createAbsoluteCCValueMatcher(0xf, 0x18));
	knob4.setBinding(remoteControls.getParameter(3));

	var knob5 = hardwareSurface.createAbsoluteHardwareKnob("KNOB_5");
	knob5.setAdjustValueMatcher(midiIn1.createAbsoluteCCValueMatcher(0xf, 0x19));
	knob5.setBinding(remoteControls.getParameter(4));

	var knob6 = hardwareSurface.createAbsoluteHardwareKnob("KNOB_6");
	knob6.setAdjustValueMatcher(midiIn1.createAbsoluteCCValueMatcher(0xf, 0x1a));
	knob6.setBinding(remoteControls.getParameter(5));

	var knob7 = hardwareSurface.createAbsoluteHardwareKnob("KNOB_7");
	knob7.setAdjustValueMatcher(midiIn1.createAbsoluteCCValueMatcher(0xf, 0x1b));
	knob7.setBinding(remoteControls.getParameter(6));

	var knob8 = hardwareSurface.createAbsoluteHardwareKnob("KNOB_8");
	knob8.setAdjustValueMatcher(midiIn1.createAbsoluteCCValueMatcher(0xf, 0x1c));
	knob8.setBinding(remoteControls.getParameter(7));

	// Create a dummy button as target for button releases to avoid invoking onMidi1
	var voidButton = hardwareSurface.createHardwareButton("VOID_BUTTON");
	var am = host.createOrHardwareActionMatcher(midiIn1.createCCActionMatcher(0xf, 0x66, 0x00), midiIn1.createCCActionMatcher(0xf, 0x67, 0x00));
	am = host.createOrHardwareActionMatcher(am, midiIn1.createCCActionMatcher(0xf, 0x70, 0x00));
	am = host.createOrHardwareActionMatcher(am, midiIn1.createCCActionMatcher(0xf, 0x71, 0x00));
	am = host.createOrHardwareActionMatcher(am, midiIn1.createCCActionMatcher(0xf, 0x72, 0x00));
	am = host.createOrHardwareActionMatcher(am, midiIn1.createCCActionMatcher(0xf, 0x73, 0x00));
	am = host.createOrHardwareActionMatcher(am, midiIn1.createCCActionMatcher(0xf, 0x74, 0x00));
	am = host.createOrHardwareActionMatcher(am, midiIn1.createCCActionMatcher(0xf, 0x75, 0x00));
	am = host.createOrHardwareActionMatcher(am, midiIn1.createActionMatcher("status == 0x9f && data1 == 0x0d && data2 == 0x7f"));
	am = host.createOrHardwareActionMatcher(am, midiIn1.createActionMatcher("status == 0x9f && data1 == 0x0f && data2 == 0x7f"));
	am = host.createOrHardwareActionMatcher(am, midiIn1.createNoteOffActionMatcher(0xf, 0x68));
	am = host.createOrHardwareActionMatcher(am, midiIn1.createNoteOffActionMatcher(0xf, 0x78));
	voidButton.pressedAction().setActionMatcher(am);
}

function blinkTimer() {
	blink = !blink;
	host.scheduleTask(blinkTimer, blinkRate);
}

function createDrumPadNoteTranslationTable(enabled) {
	var translationTable = [];
	for (i = 0; i < 128; i++) {
		if (enabled && ((i >= 0x60 && i <= 0x67) || (i >= 0x70 && i <= 0x77))) {
			translationTable[i] = drumKeyToNote(i);
		} else {
			translationTable[i] = -1;
		}
	}
	return translationTable;
}

// Called when a MIDI sysex message is received on MIDI input port 0.
//function onSysex0(data) {
//	printMidi("Received sysex data 0");
//}

// Called when a MIDI sysex message is received on MIDI input port 1.
//function onSysex1(data) {
//	println("Received sysex data 1");
//}

// Called when a short MIDI message is received on MIDI input port 0.
//function onMidi0(status, data1, data2) {
//	println("Midi 0");
//	printMidi(status, data1, data2);
//}

// Called when a short MIDI message is received on MIDI input port 1.
function onMidi1(status, data1, data2) {
	//println("Midi 1");
	//printMidi(status, data1, data2);
	if (isDrumPadMidiEvent(status, data1, data2)) {
		onSquarePad(status, data1, data2);
	}
}

function isDrumPadMidiEvent(status, data1, data2) {
	return (status == 0x9f || status == 0x8f) && data1 >= 0x60 && data1 <= 0x77 && !(data1 >= 0x68 && data1 <= 0x6f);
}

function onSquarePad(status, data1, data2) {
	if (currentMode == PLAY) {
		if (popupBrowser.exists().get()) {
			if (data2 > 0) {
				popupBrowser.cancel();
			}
		} else if (data1 >= 96 && data1 < 104) { // Row 1
			remoteControls.selectedPageIndex().set(data1 - 96);
		} else if (data2 > 0) { // Row 2
			var device = deviceBank.getDevice(data1 - 112);
			if (device.exists().get()) {
				cursorDevice.selectDevice(device);
			} else {
				device.deviceChain().endOfDeviceChainInsertionPoint().browse();
			}
		}
	} else if (currentMode == LAUNCH) { // LAUNCH mode
		var column, row;
		if (data1 >= 96 && data1 < 104) {
			column = data1 - 96;
			row = 0;
		} else {
			column = data1 - 112;
			row = 1;
		}
		var slot = trackBank.getItemAt(column).clipLauncherSlotBank().getItemAt(row);
		slot.launch();
	}
}

function previousScene() {
	if (currentMode == LAUNCH) {
		trackBank.sceneBank().scrollBackwards();
	} else {
		if (popupBrowser.exists().get()) {
			for (var i = 0; i < 20; i++) {
				popupBrowser.selectPreviousFile();
			}
		} else {
			transport.rewind();
		}
	}
}

function nextScene() {
	if (currentMode == LAUNCH) {
		trackBank.sceneBank().scrollForwards();
	} else {
		if (popupBrowser.exists().get()) {
			for (var i = 0; i < 20; i++) {
				popupBrowser.selectNextFile();
			}
		} else {
		transport.fastForward();
		}
	}
}

function previousTrack() {
	if (currentMode == LAUNCH) {
		trackBank.sceneBank().scrollPageBackwards();
	} else {
		if (popupBrowser.exists().get()) {
			popupBrowser.selectPreviousFile();
		} else {
			cursorTrack.selectPrevious();
		}
	}
}

function nextTrack() {
	if (currentMode == LAUNCH) {
		trackBank.sceneBank().scrollPageForwards();
	} else {
		if (popupBrowser.exists().get()) {
			popupBrowser.selectNextFile();
		} else {
			cursorTrack.selectNext();
		}
	}
}

function onRoundPad1() {
	onRoundPad(0);
}

function onRoundPad2() {
	onRoundPad(1);
}

function onRoundPad(pad) {
	if (popupBrowser.exists().get()) {
		if (pad == 0) {
			popupBrowser.cancel();
		} else {
			popupBrowser.commit();
		}
	} else if (currentMode == LAUNCH) {
		trackBank.sceneBank().getScene(pad).launch();
	} else if (cursorDevice.exists().get()) {
		cursorDevice.replaceDeviceInsertionPoint().browse();
	} else {
		cursorDevice.beforeDeviceInsertionPoint().browse();
	}
}

function drumKeyToNote(key) {
	if (key >= 112 && key < 116) {
		return 36 + key - 112;
	}
	if (key >= 116 && key < 120) {
		return 44 + key - 116;
	}
	if (key >= 96 && key < 100) {
		return 40 + key - 96;
	}
	if (key >= 100 && key < 104) {
		return 48 + key - 100;
	}
}


function setPlayMode() {
		host.getMidiOutPort(1).sendMidi(0x9f, 0x0d, 0x7f);
		host.showPopupNotification("PLAY mode");
		currentMode = PLAY;
		padsNoteInput.setKeyTranslationTable(translationTableDisabled);
		for (var i = 0; i < 16; i++) {
			drumPads[i].invalidate();
		}
}

function setDrumOrLaunchMode() {
	host.getMidiOutPort(1).sendMidi(0x9f, 0x0f, 0x7f);
	if (currentMode == DRUM) {
		host.showPopupNotification("LAUNCH mode");
		currentMode = LAUNCH;
		padsNoteInput.setKeyTranslationTable(translationTableDisabled);
	} else {
		host.showPopupNotification("DRUM mode");
		currentMode = DRUM;
		padsNoteInput.setKeyTranslationTable(translationTableEnabled);
	}
	for (var i = 0; i < 16; i++) {
		drumPads[i].invalidate();
	}
}

function flush() {
	if (currentMode == DRUM) {
		var white = 3;
		var offColor = 0;
		for (var i = 0; i < 16; i++) {
			var key = drumPadToKey(i);
			if (cursorTrack.playingNotes().isNotePlaying(key)) {
				drumPads[i].setColor(white);
				drumPads[i].flush();
			} else {
				var drumPad = drumPadBank.getItemAt(drumPadToKey(i) - 36);
				if (drumPad.exists().get()) {
					drumPads[i].setColor(getColorIndexClosestToColorRGB(drumPad.color().get()));
					drumPads[i].flush();
				} else {
					drumPads[i].setColor(offColor);
					drumPads[i].flush();
				}
			}
		}
	} else if (currentMode == PLAY) {
		var grey = 117;
		var white = 3;
		var offColor = 0;
		var pages = remoteControls.pageCount().get();
		var selectedPage = remoteControls.selectedPageIndex().get();
		for (var i = 0; i < 8; i++) {
			if (i == selectedPage) {
				drumPads[i].setColor(knobColors[i]);
			} else if (i < pages) {
				drumPads[i].setColor(knobColorsOff[i]);
			} else {
				drumPads[i].setColor(offColor);
			}
			drumPads[i].flush();
		}
		var devices = deviceBank.itemCount().get();
		for (var i = 0; i < 8; i++) {
			if (isCursorDevice[i].get() && deviceBank.getDevice(i).exists().get()) {
				drumPads[i + 8].setColor(white);
			} else {
				drumPads[i + 8].setColor(i < devices ? grey : offColor);
			}
			drumPads[i + 8].flush();
		}
	} else {
		var red = 72;
		var redLow = 7;
		var green = 21;
		var greenLow = 23;
		var white = 3;
		var offColor = 0;
		var grey = 117;
		for (var i = 0; i < 16; i++) {
			var column = i & 0x07;
			var row = i >> 3;
			var track = trackBank.getItemAt(column);
			var slot = track.clipLauncherSlotBank().getItemAt(row);

			if (blink) {
				if (slot.isStopQueued().get()) {
					drumPads[i].setColor(track.arm().get() ? redLow : offColor);
				} else if (slot.isPlaybackQueued().get()) {
					drumPads[i].setColor(slot.isPlaying().get() ? grey : white);
				} else if (slot.isRecordingQueued().get()) {
					drumPads[i].setColor(slot.isRecording().get() ? redLow : red);
				} else if (track.arm().get()) {
					drumPads[i].setColor(redLow);
				} else {
					drumPads[i].setColor(offColor);
				}
			} else {
				if (slot.isRecording().get()) {
					drumPads[i].setColor(red);
				} else if (slot.isPlaying().get()) {
					drumPads[i].setColor(white);
				} else if (slot.hasContent().get()) {
					var color = getColorIndexClosestToColorRGB(slot.color().get());
					drumPads[i].setColor(color);
				} else if (track.arm().get()) {
					drumPads[i].setColor(redLow);
				} else {
					drumPads[i].setColor(offColor);
				}
			}
			drumPads[i].flush();
		}
	}

	if (popupBrowser.exists().get()) {
		roundPads[0].turnOn();
		roundPads[1].turnOn();
		roundPads[0].flush();
		roundPads[1].flush();
	} else {
		roundPads[0].turnOff();
		roundPads[1].turnOff();
		roundPads[0].flush();
		roundPads[1].flush();
	}
}

function exit() {
	// Enter basic mode
	host.getMidiOutPort(1).sendMidi(0x9f, 0x0C, 0x00);
}

function drumPadToKey(pad) {
	switch(pad) {
		case 0:
			return 40;
		case 1:
			return 41;
		case 2:
			return 42;
		case 3:
			return 43;
		case 4:
			return 48;
		case 5:
			return 49;
		case 6:
			return 50;
		case 7:
			return 51;
		case 8:
			return 36;
		case 9:
			return 37;
		case 10:
			return 38;
		case 11:
			return 39;
		case 12:
			return 44;
		case 13:
			return 45;
		case 14:
			return 46;
		case 15:
			return 47;
	}
}

function getPadNumberExtended(pad) {
	switch(pad) {
		case 0:
			return 0x60;
		case 1:
			return 0x61;
		case 2:
			return 0x62;
		case 3:
			return 0x63;
		case 4:
			return 0x64;
		case 5:
			return 0x65;
		case 6:
			return 0x66;
		case 7:
			return 0x67;
		case 8:
			return 0x70;
		case 9:
			return 0x71;
		case 10:
			return 0x72;
		case 11:
			return 0x73;
		case 12:
			return 0x74;
		case 13:
			return 0x75;
		case 14:
			return 0x76;
		case 15:
			return 0x77;
	}
}

// Difference based on RGB values
function getColorIndexClosestToColorRGB(colorValue) {
	var minError = 999999;
	var colorIndex = 0;
	var color = [colorValue.red * 255, colorValue.green * 255, colorValue.blue * 255];

	var N = PALETTE.length / 3;

	for(var i=0; i<N; i++) {
		var r = PALETTE[i*3];
		var g = PALETTE[i*3+1];
		var b = PALETTE[i*3+2];

		var v1 = color[0] - r;
		var v2 = color[1] - g;
		var v3 = color[2] - b;
		var error = v1 * v1 + v2 * v2 + v3 * v3;

		if (error < minError) {
			colorIndex = i;
			minError = error;
		}
	}
	return colorIndex;
}

// Difference based on scaled HSV values
function getColorIndexClosestToColorHSV(colorValue) {
	var minError = 9999;
	var colorIndex = 0;

	var color = [colorValue.red * 255, colorValue.green * 255, colorValue.blue * 255];

	var N = PALETTE.length / 3;

	for(var i=0; i<N; i++) {
		var r = PALETTE[i*3];
		var g = PALETTE[i*3+1];
		var b = PALETTE[i*3+2];

		var hsvError = computeHsvError(r, g, b, color);

		if (hsvError < minError) {
			colorIndex = i;
			minError = hsvError;
		}
	}

	return colorIndex;
}

function computeHsvError(r, g, b, color) {
	var hsv = RGBtoHSV(r, g, b);
	var hsvRef = RGBtoHSV(color[0], color[1], color[2]);

	var hueError = (hsv[0] - hsvRef[0]) / 30;
	var sError = (hsv[1] - hsvRef[1]) * 1.6;
	var vScale = 1;
	var vError = (vScale * hsv[2] - hsvRef[2]) / 40;

	var error = hueError * hueError + vError*vError + sError*sError;

	return error;
}

function RGBtoHSV(r, g, b) {
	var min, max, delta;
	var h, s, v;
	var hsv = [0, 0, 0];

	min = Math.min(Math.min(r, g), b);
	max = Math.max(Math.max(r, g), b);
	v = max; // v

	delta = max - min;

	if (max != 0) {
		s = delta / max; // s
	} else {
		// r = g = b = 0 // s = 0, v is undefined
		s = 0;
		h = 0;

		hsv[0] = h;
		hsv[1] = s;
		hsv[2] = v;
		return hsv;
	}

	if (delta == 0) {
		h = 0;
	} else {
		if (r == max) {
			h = (g - b) / delta; // between yellow & magenta
		} else if (g == max) {
			h = 2 + (b - r) / delta; // between cyan & yellow
		} else {
			h = 4 + (r - g) / delta; // between magenta & cyan
		}
	}

	h *= 60; // degrees
	if (h < 0) {
		h += 360;
	}

	hsv[0] = h;
	hsv[1] = s;
	hsv[2] = v;
	return hsv;
}

var PALETTE = [
	0, 0, 0,
	187, 190, 187,
	239, 239, 239,
	255, 251, 255,
	255, 182, 215,
	255, 64, 75,
	246, 104, 111,
	251, 149, 154,
	255, 243, 229,
	255, 163, 0,
	255, 184, 79,
	255, 204, 118,
	255, 226, 173,
	255, 241, 42,
	255, 248, 142,
	255, 252, 190,
	217, 240, 203,
	122, 198, 46,
	160, 217, 121,
	179, 225, 147,
	0, 232, 178,
	0, 211, 0,
	0, 191, 39,
	0, 161, 36,
	0, 244, 194,
	0, 240, 75,
	0, 233, 64,
	0, 220, 13,
	44, 255, 219,
	0, 236, 196,
	0, 231, 177,
	0, 244, 194,
	1, 243, 241,
	0, 235, 224,
	0, 236, 215,
	0, 243, 222,
	46, 225, 255,
	2, 223, 255,
	2, 217, 255,
	2, 176, 226,
	81, 206, 255,
	4, 154, 255,
	4, 142, 237,
	3, 115, 212,
	133, 142, 255,
	4, 149, 254,
	64, 100, 255,
	69, 73, 231,
	188, 145, 255,
	144, 67, 255,
	106, 63, 214,
	87, 67, 205,
	255, 176, 255,
	255, 75, 255,
	232, 62, 245,
	232, 49, 246,
	255, 145, 234,
	251, 0, 203,
	250, 1, 193,
	251, 1, 186,
	255, 5, 45,
	255, 162, 0,
	250, 224, 0,
	55, 188, 97,
	0, 215, 0,
	0, 214, 151,
	5, 137, 255,
	42, 100, 255,
	2, 185, 217,
	66, 88, 231,
	179, 186, 208,
	145, 162, 183,
	255, 4, 32,
	206, 236, 103,
	199, 225, 0,
	65, 236, 0,
	0, 208, 0,
	0, 220, 160,
	2, 223, 255,
	4, 152, 255,
	95, 85, 255,
	188, 74, 255,
	237, 120, 227,
	198, 127, 61,
	255, 149, 0,
	157, 226, 0,
	131, 231, 44,
	57, 189, 98,
	0, 225, 8,
	34, 226, 187,
	1, 223, 224,
	145, 202, 255,
	106, 186, 252,
	175, 172, 245,
	229, 120, 245,
	255, 46, 211,
	252, 133, 0,
	220, 220, 0,
	136, 219, 0,
	251, 211, 0,
	211, 174, 28,
	0, 207, 94,
	0, 215, 180,
	114, 123, 194,
	67, 136, 228,
	236, 197, 159,
	255, 17, 45,
	255, 157, 161,
	251, 154, 86,
	235, 202, 100,
	179, 222, 107,
	136, 219, 0,
	99, 107, 195,
	205, 202, 159,
	127, 217, 195,
	203, 223, 255,
	186, 206, 250,
	161, 178, 190,
	187, 193, 215,
	212, 227, 255,
	255, 4, 0,
	223, 3, 11,
	140, 209, 80,
	0, 162, 0,
	253, 255, 0,
	189, 179, 0,
	251, 210, 0,
	245, 115, 0
];

class Led {
	constructor(device, color, midiOut) {
		this.device = device;
		this.needsFlush = true;
		this.color = color;
		this.on = true;
		this.midiOut = midiOut;
	}

	getColor() {
		if (this.on) {
			return this.color;
		}
		return 0;
	}

	turnOn() {
		if (!this.on) {
			this.on = true;
			this.needsFlush = true;
		}
	}

	turnOff() {
		if (this.on) {
			this.on = false;
			this.needsFlush = true;
		}
	}

	setColor(color) {
		if (this.color != color) {
			this.needsFlush = true;
			this.color = color;
		}
	}

	invalidate() {
		this.needsFlush = true;
	}

	flush() {
		if (this.needsFlush) {
			this.midiOut.sendMidi(0x9f, this.device, this.getColor());
			this.needsFlush = false;
		}
	}
}

