/**
 * @prettier
 */

const MOD_UNDER_TEST = "../node_helper.js";

const assert = require("assert");
const events = require("events");
const proxyquire = require("proxyquire");
const sinon = require("sinon");

// eslint-disable-next-line import/no-dynamic-require
const NodeHelper = require(MOD_UNDER_TEST);

const ping = require("ping");

let helper;
let fakeProbe;
let fakeSocketSend;
const baseConfig = {
  devices: [
    { name: "red", macAddress: "AA:BB:CC:DD:EE:FF" },
    { name: "green", macAddress: "FF:EE:DD:CC:BB:AA" },
  ],
};

describe("MMM-NetworkScanner node_helper", function() {
  beforeEach(function() {
    // quiet things down a bit
    sinon.replace(console, "log", sinon.fake());
    sinon.replace(console, "info", sinon.fake());

    helper = new NodeHelper();

    fakeSocketSend = sinon.fake();
    sinon.replace(helper, "sendSocketNotification", fakeSocketSend);

    helper.setName("MMM-NetworkScanner");
    helper.socketNotificationReceived("CONFIG", baseConfig);

    fakeProbe = sinon.stub(ping.sys, "probe").callsFake((ipAddr, cb) => {
      cb(true);
    });
  });

  afterEach(function() {
    sinon.restore();
  });

  describe("#socketNotificationReceived()", function() {
    it("accepts and copies config to itself on CONFIG notification", function() {
      assert.deepStrictEqual(helper.config, baseConfig);
    });

    it("initiates arp scan & pings on SCAN_NETWORK notification", function() {
      const fakeMacScan = sinon.fake();
      const fakeIpScan = sinon.fake();

      sinon.replace(helper, "scanNetworkMAC", fakeMacScan);
      sinon.replace(helper, "scanNetworkIP", fakeIpScan);

      assert(helper.socketNotificationReceived("SCAN_NETWORK"));

      assert(fakeMacScan.calledOnce);
      assert(fakeIpScan.calledOnce);
    });
  });

  describe("#findDeviceByMacAddress()", function() {
    const unknownMac = "66:66:66:66:66:66";

    it("finds configured devices by mac address", function() {
      const [red, green] = baseConfig.devices;

      assert.deepStrictEqual(helper.findDeviceByMacAddress(red.macAddress), red);
      assert.deepStrictEqual(helper.findDeviceByMacAddress(green.macAddress), green);
    });

    it("returns null when a device is not configured", function() {
      assert.strictEqual(helper.findDeviceByMacAddress(unknownMac), null);
    });

    it("returns an unknown device when device not configured and showUnknown is enabled", function() {
      const unknownDevice = {
        macAddress: unknownMac,
        name: unknownMac,
        icon: "question",
        type: "Unknown",
      };

      helper.socketNotificationReceived("CONFIG", { ...baseConfig, showUnknown: true });

      assert.deepStrictEqual(helper.findDeviceByMacAddress(unknownMac), unknownDevice);
    });
  });

  describe("#performArpScan()", function() {
    let fakeStream;
    let _helper;

    beforeEach(function() {
      fakeStream = new events.EventEmitter();
      fakeStream.stdout = new events.EventEmitter();
      fakeStream.stderr = new events.EventEmitter();

      // XXX: hacky but we need to intercept the require for "sudo"
      const _NodeHelper = proxyquire(MOD_UNDER_TEST, {
        sudo: () => {
          return fakeStream;
        },
      });

      _helper = new _NodeHelper();
    });

    it("resolves to captured stdout", async function() {
      const msg = "something something";
      const out = _helper.performArpScan();

      fakeStream.stdout.emit("data", msg);
      fakeStream.emit("close", 0);

      assert.strictEqual(await out, msg);
    });

    it("rejects when return code is not 0", async function() {
      const errMsg = "something BAD";
      const out = _helper.performArpScan();

      fakeStream.stderr.emit("data", errMsg);
      fakeStream.emit("close", -1);

      await assert.rejects(out, Error, errMsg);
    });
  });

  describe("#parseArpScan()", function() {
    // watch out for the tabs in this buffer- they need to be retained
    const buffer = `
XXX	THIS	SHOULDN'T	BE	PARSED	XXX
10.0.65.8	00:18:0a:d0:15:fb	Cisco	Meraki
10.0.65.9	00:18:0a:d0:15:fb	Cisco	Meraki`;

    it("can parse an arp scan", function() {
      assert.deepStrictEqual(helper.parseArpScan(buffer), ["00:18:0A:D0:15:FB"]);
    });
  });

  describe("#scanNetworkMAC()", function() {
    it("associates arp scan output with configured devices", async function() {
      const [red, green] = baseConfig.devices;
      // watch out for the tabs in this buffer- they need to be retained
      const buffer = `
XXX	THIS	SHOULD	NOT	BE	PARSED	XXX
10.0.0.100	AA:BB:CC:DD:EE:FF	red
10.0.0.200	FF:EE:DD:CC:BB:AA	green
10.0.0.666	66:66:66:66:66:66	unknown-device`;

      const fakePerformArp = sinon.fake.returns(buffer);

      sinon.replace(helper, "performArpScan", fakePerformArp);

      await helper.scanNetworkMAC();

      assert(
        fakeSocketSend.calledOnceWith("MAC_ADDRESSES", [
          { ...red, online: true },
          { ...green, online: true },
        ])
      );
    });
  });

  describe("#performPing()", function() {
    it("resolves to result of ping probe", async function() {
      assert(await helper.performPing("1.1.1.1"));
    });
  });

  describe("#scanNetworkIP()", function() {
    it("does nothing when no devices are configured", async function() {
      helper.socketNotificationReceived("CONFIG", { devices: [] });

      await helper.scanNetworkIP();

      assert(fakeProbe.notCalled);
    });

    it("probes each device with a configured IP", async function() {
      const newDevice = { name: "NEW", ipAddress: "10.0.0.10" };

      helper.socketNotificationReceived("CONFIG", { devices: [...baseConfig.devices, newDevice] });

      await helper.scanNetworkIP();

      assert(fakeSocketSend.calledOnceWith("IP_ADDRESS", { ...newDevice, online: true }));
    });
  });
});
