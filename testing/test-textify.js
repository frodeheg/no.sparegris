/* eslint-disable comma-dangle */

'use strict';

const fs = require('fs');
// const { PNG } = require('pngjs/browser');
const Textify = require('../lib/textify');

// Driver Manifest references
const VALIDATION_SETTINGS = 0;
const STATUS_GOTAMP = 0;
const STATUS_GOTWATT = 0;
const STATUS_GOTBATTERY = 0;
const STATUS_GOTDISCONNECT = 0;
const STATUS_GOTCONNECT = 0;
const STATUS_GOTDONE = 0;
const STATUS_GOTERROR = 0;
const okText = '[\u001b[32;1m OK \u001b[37m]';
const errText = '[\u001b[31;1mFAIL\u001b[37m]';
const progressText = '[\u001b[37;0m....\u001b[37;1m]';

class Test {

  constructor() {
    this.driver = {
      manifest: {
        settings: [{
          children: [
            {
              label: { "en": "Amp Usage Received" },
              hint: { "en": "Please make sure a flow updates this device with how many amps the charger is actually charging with whenever the value changes." }
            }
          ]
        }]
      }
    };
    this.settingsManifest = this.driver.manifest.settings[VALIDATION_SETTINGS].children;
    this.homey = {
      __: (param) => { return param.en; }
    }
  }

  async run() {
    const dst = new Textify({
      width: 500,
      height: 500,
      colorType: 2,
      filterType: 4,
      bgColor: { red: 80, green: 80, blue: 80 },
      textCol: { r: 255, g: 255, b: 255, a: 255 },
      textBg: { r: 0, g: 0, b: 0, a: 0 }
    });
    this.settings = {
      GotSignalStatusConnected: 'True',
      GotSignalAmps: 'True',
      GotSignalWatt: 'True',
      GotSignalBattery: 'True',
      GotSignalStatusDisconnected: 'True',
      GotSignalStatusDone: 'False',
      GotSignalStatusError: 'False'
    };
    const xaxis = [];
    for (let i = 0; i < 24; i++) {
      xaxis[i] = `${String(i).padStart(2, ' ')}:00`;
    }
    dst.loadFile('../drivers/piggy-charger/assets/images/notValid.png')
/*      // --- START COPY ---
      .then(() => dst.setCursorWindow(190, 80, 460, 170))
      .then(() => dst.setTextColor([255, 128, 128, 255]))
      .then(() => dst.addText('The device can not be used\nbefore the check-list below\nhas been completed\n'))
      .then(() => dst.addText('-----------------------------'))
      .then(() => dst.setCursorWindow(40, 185, 460, 460))
      .then(() => dst.setTextColor([255, 255, 255, 255]))
      .then(() => this.runTurnedOnTest(dst))
      .then(() => this.runConnectedTest(dst))
      .then(() => this.runAmpTest(dst))
      .then(() => this.runWattTest(dst))
      .then(() => this.runBatteryTest(dst))
      .then(() => this.runDisconnectTest(dst))
      .then(() => dst.addText(`${progressText} Press refresh for updates\n`))
      .catch((err) => dst.addText(`\u001b[35;m${err.message}\n`))
      .finally(() => dst.addText('\u001b[0m(maintenance action "reset" will start over)\u001b[1m\n'))
      // --- END COPY ---
      */
      // --- START DRAW TEST ---
      /* .then(() => dst.setCursorWindow(40, 185, 460, 460))
      .then(() => dst.setTextAngle(25))
      .then(() => dst.setTextSize(1))
      .then(() => dst.addText(`${okText}Hei, test`)) */
      .then(() => dst.drawLineChart(50, 150, 400, 300, {
        xaxis,
        values: [0.1, 0.4, 1.2, 0.8],
        gridcol: [128, 128, 128, 255],
        ycol: [128, 128, 128, 255],
        xcol: [128, 128, 128, 255],
        linecol: [255, 255, 128, 255]
      }))
      // --- END DRAW TEST ---
      .then(() => dst.pack().pipe(fs.createWriteStream('out.png')));
  }

  /**
   * The test procedure is as follows:
   * 1) Check that a car is connected (requires the user to have updated the flow)
   */
  async runTest(dst, settingId, value) {
    const text = this.settingsManifest[settingId];
    if (value !== 'True') {
      dst.addText(`${errText} ${this.homey.__(text.label)}\n`);
      return Promise.reject(new Error(`${this.homey.__(text.hint)}\n`));
    }
    dst.addText(`${okText} ${this.homey.__(text.label)}\n`);
    return Promise.resolve();
  }

  async runTurnedOnTest(dst) {
    dst.addText(`${okText} ${'Turned on'}\n`);
    return Promise.resolve();
  }

  async runConnectedTest(dst) {
    return this.runTest(dst, STATUS_GOTCONNECT, this.settings.GotSignalStatusConnected);
  }

  async runAmpTest(dst) {
    return this.runTest(dst, STATUS_GOTAMP, this.settings.GotSignalAmps);
  }

  async runWattTest(dst) {
    return this.runTest(dst, STATUS_GOTWATT, this.settings.GotSignalWatt);
  }

  async runBatteryTest(dst) {
    return this.runTest(dst, STATUS_GOTBATTERY, this.settings.GotSignalBattery);
  }

  async runDisconnectTest(dst) {
    return this.runTest(dst, STATUS_GOTDISCONNECT, this.settings.GotSignalStatusDisconnected);
  }

/*
const  = 0;
const  = 0;
const STATUS_GOTDONE = 0;
const STATUS_GOTERROR = 0;*/

}

const myTest = new Test();
myTest.run();