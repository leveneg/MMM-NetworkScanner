/**
 * @prettier
 */

/* Magic Mirror
 * Node Helper: MMM-NetworkScanner
 *
 * By Ian Perrin http://ianperrin.com
 * MIT Licensed.
 */

/* eslint-disable-next-line import/no-extraneous-dependencies */
const NodeHelper = require("node_helper");
const os = require("os");
const ping = require("ping");
const sudo = require("sudo");

module.exports = NodeHelper.create({
  start() {
    this.log(`Starting module: ${this.name}`);
  },

  // Override socketNotificationReceived method.
  socketNotificationReceived(notification, payload) {
    this.log(`${this.name} received ${notification}`);

    if (notification === "CONFIG") {
      this.config = payload;

      return true;
    }

    if (notification === "SCAN_NETWORK") {
      this.scanNetworkMAC();
      this.scanNetworkIP();

      return true;
    }

    return false;
  },

  performArpScan(arpMask = "-l") {
    this.log(`${this.name} performing arp-scan`);

    return new Promise((resolve, reject) => {
      let out = "";
      let err = "";
      const spawn = sudo(["arp-scan", "-q", arpMask]);

      spawn.stdout.on("data", data => {
        out += data;
      });

      spawn.stderr.on("data", data => {
        err += data;
      });

      spawn.on("error", data => {
        err += data;
      });

      spawn.on("close", code => {
        if (code !== 0) {
          this.log(`${this.name} encountered error in arp-scan:`);
          this.log(err);
          reject(new Error(err));
        }

        resolve(out);
      });
    });
  },

  parseArpScan(buffer) {
    const rows = buffer.split(os.EOL);
    const macs = new Set();

    for (let i = 2; i < rows.length; i += 1) {
      const cells = rows[i].split("\t").filter(String);
      // eslint-disable-next-line no-unused-vars, prefer-const
      let [ipAddr, macAddr, ...rest] = cells;

      if (!ipAddr || !macAddr) {
        continue;
      }

      macAddr = macAddr.toUpperCase();
      macs.add(macAddr);
    }

    return Array.from(macs);
  },

  async scanNetworkMAC() {
    const arp = await this.performArpScan(this.config.network);
    const arpMacs = this.parseArpScan(arp);
    const discovered = [];

    for (let i = 0; i < arpMacs.length; i += 1) {
      const macAddr = arpMacs[i];
      const device = this.findDeviceByMacAddress(macAddr);

      if (device) {
        device.online = true;
        discovered.push(device);
      }
    }

    this.log(`${this.name} arp scan addresses: `, arpMacs);
    this.log(`${this.name} arp scan devices: `, discovered);
    this.sendSocketNotification("MAC_ADDRESSES", discovered);
  },

  performPing(ipAddr) {
    return new Promise(resolve => {
      ping.sys.probe(ipAddr, isAlive => {
        this.log(`${this.name} ping result: `, [ipAddr, isAlive]);
        resolve(isAlive);
      });
    });
  },

  async scanNetworkIP() {
    if (!this.config.devices) {
      return;
    }

    for (let i = 0; i < this.config.devices.length; i += 1) {
      const device = this.config.devices[i];

      if (!("ipAddress" in device)) {
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const isAlive = await this.performPing(device.ipAddress);

      device.online = isAlive;
      this.sendSocketNotification("IP_ADDRESS", device);
    }
  },

  findDeviceByMacAddress(macAddress) {
    // Find first device with matching macAddress
    for (let i = 0; i < this.config.devices.length; i += 1) {
      const device = this.config.devices[i];

      if (Object.prototype.hasOwnProperty.call(device, "macAddress")) {
        if (macAddress.toUpperCase() === device.macAddress.toUpperCase()) {
          this.log(`${this.name} found device by MAC Address`, device);
          return { ...device, macAddress: device.macAddress.toUpperCase() };
        }
      }
    }

    // Return macAddress (if showing unknown) or null
    if (this.config.showUnknown) {
      return { macAddress, name: macAddress, icon: "question", type: "Unknown" };
    }

    return null;
  },

  log(message, object) {
    // Log if config is missing or in debug mode
    if (!this.config || this.config.debug) {
      if (object) {
        console.info(message, object);
      } else {
        console.info(message);
      }
    }
  },
});
