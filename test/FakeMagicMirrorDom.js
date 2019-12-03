/**
 * @prettier
 */

const fs = require("fs");
const path = require("path");
const { Script } = require("vm");
const { promisify } = require("util");

const { JSDOM } = require("jsdom");

const readFile = promisify(fs.readFile);

const cache = {
  html: null,
  scripts: {
    "class.js": null,
    "module.js": null,
    "logger.js": null,
  },
};

async function cacheHtml(mmDir) {
  if (cache.html) {
    return;
  }

  cache.html = await readFile(path.join(mmDir, "index.html"), "utf8");
}

async function cacheScripts(mmDir) {
  if (Object.values(cache.scripts).every(s => !!s)) {
    return;
  }

  const scriptNames = Object.keys(cache.scripts);
  const promises = [];

  for (let i = 0; i < scriptNames.length; i += 1) {
    const scriptName = scriptNames[i];
    const joinedPath = path.join(mmDir, "js", scriptName);

    promises.push(
      (async () => {
        const scriptContent = await readFile(joinedPath, "utf8");
        cache.scripts[scriptName] = new Script(scriptContent);
      })()
    );
  }

  await Promise.all(promises);
}

module.exports = async function getFakeMagicMirrorDom(mmDir, mmConfig) {
  await cacheHtml(mmDir);
  await cacheScripts(mmDir);

  const dom = new JSDOM(cache.html, { runScripts: "outside-only" });
  dom.window.config = mmConfig;
  // XXX: This is probably not the best thing to do
  dom.window.console = console;
  const scripts = Object.values(cache.scripts);

  for (let i = 0; i < scripts.length; i += 1) {
    dom.runVMScript(scripts[i]);
  }

  return dom;
};
