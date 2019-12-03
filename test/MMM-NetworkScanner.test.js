/**
 * @prettier
 */

const assert = require("assert");
const fs = require("fs");
const sinon = require("sinon");
const { Script } = require("vm");

// eslint-disable-next-line import/no-extraneous-dependencies
const moment = require("moment");

const getFakeDom = require("./FakeMagicMirrorDom");

const ROOT_MM_DIR = "../../";
const MOD_UNDER_TEST = "MMM-NetworkScanner.js";
const MODULE_SCRIPT = new Script(fs.readFileSync(MOD_UNDER_TEST, "utf8"));
const MODULE_CONFIG = {
  module: "MMM-NetworkScanner",
  config: {
    debug: false,
    keepAlive: 10,
    devices: [
      { name: "red", macAddress: "AA:BB:CC:DD:EE:FF" },
      { name: "green", macAddress: "FF:EE:DD:CC:BB:AA" },
    ],
  },
};
const BASE_CONFIG = { language: "en", modules: [MODULE_CONFIG] };

let dom;
let mod;

// eslint-disable-next-line mocha/no-hooks-for-single-case
beforeEach(async function() {
  dom = await getFakeDom(ROOT_MM_DIR, { ...BASE_CONFIG });

  dom.window.moment = moment;
  dom.runVMScript(MODULE_SCRIPT);

  // take care of some stuff normally taken care of by MM
  mod = dom.window.Module.definitions["MMM-NetworkScanner"];
  mod.config = { ...MODULE_CONFIG.config };
  mod.name = "MMM-NetworkScanner";
  mod.sendSocketNotification = sinon.stub();
  mod.translate = sinon.stub().callsFake(txt => txt);
});

// eslint-disable-next-line mocha/no-hooks-for-single-case
afterEach(async function() {
  sinon.restore();
  dom.window.close();
});

describe("MMM-NetworkScanner client script", function() {
  describe("#validateDevices()", function() {
    it("fills missing device properties", function() {
      // add an empty device
      mod.config.devices = [...mod.config.devices, {}];

      mod.validateDevices();

      const [red, green] = MODULE_CONFIG.config.devices;
      const nexts = [
        { ...red, icon: "question", color: "#ffffff", showOffline: true },
        { ...green, icon: "question", color: "#ffffff", showOffline: true },
        { icon: "question", color: "#ffffff", showOffline: true, name: "Unknown" },
      ];

      assert.deepStrictEqual(mod.config.devices, nexts);
    });

    it("normalizes mac address capitalization", function() {
      mod.config.devices = [...mod.config.devices, { macAddress: "dd:ee:ff:aa:bb:cc" }];

      mod.validateDevices();

      for (let i = 0; i < mod.config.devices.length; i += 1) {
        const { macAddress } = mod.config.devices[i];

        assert.strictEqual(macAddress, macAddress.toUpperCase());
      }
    });
  });

  describe("#updateDeviceStatus()", function() {
    it("updates the last time a device was seen when it is online", function() {
      const device = {};

      mod.updateDeviceStatus(device, true);

      // XXX: bleh this is probably dumb and should be deleted
      assert(moment().diff(device.lastSeen) < 30);
    });

    it("expressly marks devices offline after $keepAlive time passed", function() {
      const device = { lastSeen: moment().subtract(12, "seconds") };

      mod.updateDeviceStatus(device, false);

      assert.strictEqual(device.online, false);
    });
  });

  describe("#getDom()", function() {
    it("generates HTML for the module", function() {
      mod.getDom();
    });
  });
});
