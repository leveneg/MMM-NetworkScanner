/* Magic Mirror
 * Node Helper: MMM-NetworkScanner
 *
 * By Ian Perrin http://ianperrin.com
 * MIT Licensed.
 */

/* @format prettier */

/* eslint-disable-next-line import/no-extraneous-dependencies */
const NodeHelper = require("node_helper");
const ping = require("ping");
const sudo = require("sudo");

module.exports = NodeHelper.create({
  start() {
    this.log(`Starting module: ${  this.name}`);
  },

  // Override socketNotificationReceived method.
  socketNotificationReceived(notification, payload) {
    this.log(`${this.name  } received ${  notification}`);

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

  scanNetworkMAC() {
    this.log(`${this.name  } is performing arp-scan`);

    const self = this;
    // Target hosts/network supplied in config or entire localnet
    const arpHosts = this.config.network || '-l';
    const arp = sudo(['arp-scan', '-q', arpHosts]);
    let buffer = '';
    let errstream = '';
    const discoveredMacAddresses = [];
    const discoveredDevices = [];

    arp.stdout.on('data', data => {
      buffer += data;
    });

    arp.stderr.on('data', data => {
      errstream += data;
    });

    arp.on('error', err => {
      errstream += err;
    });

    arp.on('close', code => {
      if (code !== 0) {
        self.log(`${self.name  } received an error running arp-scan: ${  code  } - ${  errstream}`);
        return;
      }

      // Parse the ARP-SCAN table response
      const rows = buffer.split('\n');
      for (let i = 2; i < rows.length; i+=1) {
        const cells = rows[i].split('\t').filter(String);

        // Update device status
        if (cells && cells[1]) {
          const macAddress = cells[1].toUpperCase();
          if (macAddress && discoveredMacAddresses.indexOf(macAddress) === -1) {
            discoveredMacAddresses.push(macAddress);
            const device = self.findDeviceByMacAddress(macAddress);
            if (device) {
              device.online = true;
              discoveredDevices.push(device);
            }
          }
        }
      }

      self.log(`${self.name  } arp scan addresses: `, discoveredMacAddresses);
      self.log(`${self.name  } arp scan devices: `, discoveredDevices);
      self.sendSocketNotification("MAC_ADDRESSES", discoveredDevices);
    });
  },

  scanNetworkIP() {
    if (!this.config.devices) {
      return;
    }

    this.log(`${this.name  } is performing ip address scan`);

    const discoveredDevices = [];
    const self = this;
    this.config.devices.forEach(device => {
      self.log(`${self.name  } is checking device: `, device.name);

      if ("ipAddress" in device) {
        self.log(`${self.name  } is pinging `, device.ipAddress);

        ping.sys.probe(device.ipAddress, isAlive => {
          /* eslint-disable-next-line no-param-reassign */
          device.online = isAlive;
          self.log(`${self.name  } ping result: `, [device.name, device.online] );
          if (device.online) {
            discoveredDevices.push(device);
          }
          self.sendSocketNotification("IP_ADDRESS", device);
        });
      }
    });
  },

  findDeviceByMacAddress (macAddress) {
    // Find first device with matching macAddress
    for (let i = 0; i < this.config.devices.length; i+=1) {
      const device = this.config.devices[i];

      if (Object.prototype.hasOwnProperty.call(device, "macAddress")) {
        if (macAddress.toUpperCase() === device.macAddress.toUpperCase()){
          this.log(`${this.name  } found device by MAC Address`, device);
          return { ...device, macAddress: device.macAddress.toUpperCase() };
        }
      }
    }

    // Return macAddress (if showing unknown) or null
    if (this.config.showUnknown) {
      return {macAddress, name: macAddress, icon: "question", type: "Unknown"};
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
