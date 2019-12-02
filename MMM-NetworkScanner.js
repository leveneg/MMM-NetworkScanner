/*
 * Magic Mirror
 * Module: MMM-NetworkScanner
 *
 * By Ian Perrin http://ianperrin.com
 * MIT Licensed.
 */

/* @format prettier */
/* global config, Log, Module, moment */
/* eslint-env browser */

Module.register("MMM-NetworkScanner", {
  // Default module config.
  defaults: {
    /*
     * an array of device objects e.g. [{
     *  macAddress: "aa:bb:cc:11:22:33",
     *  name: "DEVICE-NAME",
     *  icon: "FONT-AWESOME-ICON"
     * }]
     */
    devices: [],

    /*
     * CIDR mask for the mac address scan (e.g.  `192.168.0.0/24`).
     * Use `-l` for the entire localnet.
     */
    network: "-l",

    /*
     * shows devices found on the network even if not specified in the
     * 'devices' option
     */
    showUnknown: true,

    /*
     * shows devices specified in the 'devices' option even when offline
     */
    showOffline: true,

    /*
     * shows when the device was last seen e.g. "Device Name - last seen 5
     * minutes ago"
     */
    showLastSeen: false,

    /*
     * how long (in seconds) a device should be considered 'alive' since it was
     * last found on the network
     */
    keepAlive: 180,

    /*
     * how often (in seconds) the module should scan the network
     */
    updateInterval: 20,

    /*
     * sort the devices in the mirror
     */
    sort: true,

    /*
     * array of device names to be monitored if they are online
     */
    residents: [],

    /*
     * {notification: 'TEST', payload: {action: 'occupiedCMD'}},
     */
    occupiedCMD: null,

    /*
     * {notification: 'TEST', payload: {action: 'vacantCMD'}},
     */
    vacantCMD: null,

    /*
     * show devices colorcoded with color defined in devices []
     */
    colored: false,

    /*
     * show symbol only in color
     */
    coloredSymbolOnly: false,

    /*
     * show last seen only when offline
     */
    showLastSeenWhenOffline: false,

    /*
     * add additional logging
     */
    debug: false,
  },

  // Subclass start method.
  start() {
    Log.info(`Starting module: ${this.name}`);

    if (this.config.debug) {
      Log.info(`${this.name} config: `, this.config);
    }

    moment.locale(config.language);

    // variable for if anyone is home
    this.occupied = true;
    this.validateDevices();
    this.sendSocketNotification("CONFIG", this.config);
    this.scanNetwork();
  },

  // Subclass getStyles method.
  getStyles() {
    return ["MMM-NetworkScanner.css", "font-awesome.css"];
  },

  // Subclass getScripts method.
  getScripts() {
    return ["moment.js"];
  },

  // Subclass socketNotificationReceived method.
  socketNotificationReceived(notification, payload) {
    if (this.config.debug) {
      Log.info(`${this.name} received a notification: ${notification}`, payload);
    }

    let device;
    const self = this;
    const getKeyedObject = (objects, key) =>
      objects.reduce(
        (acc, object) =>
          Object.assign(acc, {
            [object[key]]: object,
          }),
        {}
      );

    if (notification === "IP_ADDRESS") {
      if (this.config.debug) {
        Log.info(`${this.name} IP_ADDRESS device: `, [payload.name, payload.online]);
      }

      if (Object.prototype.hasOwnProperty.call(payload, "ipAddress")) {
        device = this.config.devices.find(d => d.ipAddress === payload.ipAddress);
        this.updateDeviceStatus(device, payload.online);
      }
    }

    if (notification === "MAC_ADDRESSES") {
      if (this.config.debug) {
        Log.info(`${this.name} MAC_ADDRESSES payload: `, payload);
      }

      const payloadDevices = getKeyedObject(payload, "macAddress");
      const combinedDevices = (this.networkDevices || []).concat(this.config.devices);
      let nextDevices = {};

      for (let i = 0; i < combinedDevices.length; i+=1) {
        device = { ...combinedDevices[i] };
        const { lastSeen, macAddress } = device;

        if (macAddress in payloadDevices) {
          device = { ...device, ...payloadDevices[macAddress] };
          nextDevices[macAddress] = { ...device, lastSeen: moment() };
          continue;
        }

        // becuase it's easier than filtering dups from combinedDevices
        if (macAddress in nextDevices) {
          continue;
        }

        const sinceLastSeen = lastSeen ? moment().diff(lastSeen, "seconds") : Infinity;

        device.online = sinceLastSeen <= this.config.keepAlive;

        if (device.online || this.config.showOffline) {
          nextDevices[macAddress] = device;
        }
      }

      if (this.config.showUnknown) {
        nextDevices = { ...payloadDevices, ...nextDevices };
      }

      this.networkDevices = Object.values(nextDevices);

      // Sort list by known device names, then unknown device mac addresses
      if (this.config.sort) {
        this.networkDevices.sort((a, b) => {
          const stringA = a.type !== "Unknown" ? `_${a.name}${a.macAddress}` : a.name;
          const stringB = b.type !== "Unknown" ? `_${b.name}${b.macAddress}` : b.name;

          return stringA.localeCompare(stringB);
        });
      }

      // Send notification if user status has changed
      if (this.config.residents.length > 0) {
        let anyoneHome;
        anyoneHome = 0;

        this.networkDevices.forEach(d => {
          if (self.config.residents.indexOf(d.name) >= 0) {
            anyoneHome += d.online;
          }
        });

        if (this.config.debug) {
          Log.info("# people home: ", anyoneHome);
          Log.info("Was occupied? ", this.occupied);
        }

        if (anyoneHome > 0) {
          if (this.occupied === false) {
            if (this.config.debug) {
              Log.info("Someone has come home");
            }

            if (this.config.occupiedCMD) {
              const { occupiedCMD } = self.config;
              this.sendNotification(occupiedCMD.notification, occupiedCMD.payload);
            }
            this.occupied = true;
          }
        } else if (this.occupied === true) {
          if (this.config.debug) {
            Log.info("Everyone has left home");
          }

          if (this.config.vacantCMD) {
            const { vacantCMD } = this.config;
            this.sendNotification(vacantCMD.notification, vacantCMD.payload);
          }
          this.occupied = false;
        }
      }

      this.updateDom();
    }
  },

  // Override dom generator.
  getDom() {
    const self = this;

    const wrapper = document.createElement("div");
    wrapper.classList.add("small");

    // Display a loading message
    if (!this.networkDevices) {
      wrapper.innerHTML = this.translate("LOADING");
      return wrapper;
    }

    // Display device status
    const deviceTable = document.createElement("table");
    deviceTable.classList.add("small");
    this.networkDevices.forEach(device => {
      if (device && (device.online || device.showOffline)) {
        // device row

        const deviceRow = document.createElement("tr");
        const deviceOnline = device.online ? "bright" : "dimmed";
        deviceRow.classList.add(deviceOnline);

        // Icon
        const deviceCell = document.createElement("td");
        deviceCell.classList.add("device");
        const icon = document.createElement("i");
        icon.classList.add("fa", "fa-fw", `fa-${device.icon}`);

        if (self.config.colored) {
          icon.style.cssText = `color: ${device.color}`;
        }

        if (self.config.colored && !self.config.coloredSymbolOnly && device.lastSeen) {
          deviceCell.style.cssText = `color: ${device.color}`;
        }

        deviceCell.appendChild(icon);
        deviceCell.innerHTML += device.name;

        deviceRow.appendChild(deviceCell);

        // When last seen
        if (
          (self.config.showLastSeen && device.lastSeen && !self.config.showLastSeenWhenOffline) ||
          (self.config.showLastSeen && !device.lastSeen && self.config.showLastSeenWhenOffline)
        ) {
          const dateCell = document.createElement("td");
          dateCell.classList.add("date", "dimmed", "light");
          if (typeof device.lastSeen !== "undefined") {
            dateCell.innerHTML = device.lastSeen.fromNow();
          }
          deviceRow.appendChild(dateCell);
        }

        deviceTable.appendChild(deviceRow);
      } else if (this.config.debug) Log.info(`${self.name} Online, but ignoring: '${device}'`);
    });
    if (deviceTable.hasChildNodes()) {
      wrapper.appendChild(deviceTable);
    } else {
      // Display no devices online message
      wrapper.innerHTML = this.translate("NO DEVICES ONLINE");
    }

    return wrapper;
  },

  validateDevices() {
    this.config.devices.forEach(device => {
      // Add missing device attributes.
      if (!Object.prototype.hasOwnProperty.call(device, "icon")) {
        /* eslint-disable-next-line no-param-reassign */
        device.icon = "question";
      }
      if (!Object.prototype.hasOwnProperty.call(device, "color")) {
        /* eslint-disable-next-line no-param-reassign */
        device.color = "#ffffff";
      }
      if (!Object.prototype.hasOwnProperty.call(device, "showOffline")) {
        /* eslint-disable-next-line no-param-reassign */
        device.showOffline = true;
      }
      if (!Object.prototype.hasOwnProperty.call(device, "name")) {
        if (Object.prototype.hasOwnProperty.call(device, "macAddress")) {
          /* eslint-disable-next-line no-param-reassign */
          device.name = device.macAddress;
        } else if (Object.prototype.hasOwnProperty.call(device, "ipAddress")) {
          /* eslint-disable-next-line no-param-reassign */
          device.name = device.ipAddress;
        } else {
          /* eslint-disable-next-line no-param-reassign */
          device.name = "Unknown";
        }
      }

      // normalize MAC address
      if (Object.prototype.hasOwnProperty.call(device, "macAddress")) {
        /* eslint-disable-next-line no-param-reassign */
        device.macAddress = device.macAddress.toUpperCase();
      }
    });
  },

  scanNetwork() {
    if (this.config.debug) Log.info(`${this.name} is initiating network scan`);
    const self = this;
    this.sendSocketNotification("SCAN_NETWORK");
    setInterval(() => {
      self.sendSocketNotification("SCAN_NETWORK");
    }, this.config.updateInterval * 1000);
  },

  updateDeviceStatus(device, online) {
    if (device) {
      if (this.config.debug) Log.info(`${this.name} is updating device status.`, [device.name, online]);
      // Last Seen
      if (online) {
        /* eslint-disable-next-line no-param-reassign */
        device.lastSeen = moment();
      }
      // Keep alive?
      const sinceLastSeen = device.lastSeen ? moment().diff(device.lastSeen, "seconds") : null;
      const isStale = sinceLastSeen >= this.config.keepAlive;
      /* eslint-disable-next-line no-param-reassign */
      device.online = sinceLastSeen != null && !isStale;
      if (this.config.debug) Log.info(`${this.name} ${device.name} is ${online ? "online" : "offline"}`);
    }
  },
});
