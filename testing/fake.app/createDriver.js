#!/usr/local/bin/node

const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fs = require('fs');

async function parseArgs() {
  let parsed = {};
  let print_help = false;
  for (let arg = 2; arg < process.argv.length; arg++) {
    switch (process.argv[arg]) {
      case '-i':
        parsed.input = process.argv[++arg];
        break;
      case '--replace':
        parsed.replace = true;
        break;
      case '--clear':
        parsed.clear = true;
        break;
        default:
        print_help = true;
        break;
    }
  }
  if (parsed.input === undefined || print_help) {
    return Promise.reject(new Error("Usage: ./createDriver ...params...\n"
    + "  -i [input_file_name]   - This is the path to the driver definition file (required)\n"
    + "  --replace              - Replaces the fake app ID with the driver ID from the input file\n"
    + "  --clear                - Clears the driver cache\n"));
  }
  return Promise.resolve(parsed);
}

async function readDefinition(filename) {
  let definition = { capabilitiesObj: {} };
  const data = fs.readFileSync(filename, 'utf8');
  const lines = data.split('\n');
  let startFound = false;
  let driverUri;
  let driverId;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].slice(lines[i].indexOf(': ') + 2);
    if (!startFound) {
      if (line.includes('----- ANALYZING DEVICE -----')) startFound = true;
      continue;
    }
    if (line.includes('--- ANALYZING DEVICE DONE ---')) break;
    let parsed = line.slice(line.indexOf(':') + 1);
    parsed = parsed.replace(/^\s+/, '');
    let capName = line.slice(line.indexOf('\'') + 1);
    capName = capName.slice(0, capName.indexOf('\''));
    if (line.includes('Device ID:')) definition.id = parsed;
    else if (line.includes('Device Name:')) definition.name = parsed;
    else if (line.includes('Driver Uri:')) driverUri = parsed;
    else if (line.includes('Driver Id:')) driverId = parsed;
    else if (line.includes('Options for')) definition.capabilitiesObj[capName] = JSON.parse(parsed);
    else if (line.includes('Capabilities:')) definition.capabilities = parsed.split(',');
  }
  definition.driverId = (driverUri ? `${driverUri}:${driverId}` : driverId).split(":");
  return Promise.resolve(definition);
}


async function createCaps(capabilitiesObj) {
  // Do not create a cap more than once (remove subcaps)
  const handledCaps = {};
  for (let fullCapName in capabilitiesObj) {
    const capName = fullCapName.split('.')[0];
    if (capName in handledCaps) continue;
    handledCaps[capName] = true;
    const capFileName = `.homeycompose/capabilities/${capName}.json`;
    let { type, title, units, insights, getable, setable, values, insightsTitleTrue, insightsTitleFalse, titleTrue, titleFalse, decimals } = capabilitiesObj[capName];
    if (insightsTitleTrue === null) insightsTitleTrue = undefined;
    if (insightsTitleFalse === null) insightsTitleFalse = undefined;
    const uiComponent = !setable ? 'sensor'
      : type === 'boolean' ? 'toggle'
      : type === 'string' ? null
      : type === 'enum' ? 'picker'
      : type === 'number' ? 'slider' //thermostat color battery
      : null;
    const capData = {
      type, title, units, insights, getable, setable, uiComponent, values, insightsTitleTrue, insightsTitleFalse, titleTrue, titleFalse, decimals
    };
    console.log(`Creating capability '${capName}'`);// console.log(capabilitiesObj[capName]);
    fs.writeFileSync(capFileName, JSON.stringify(capData));
    //console.log(`Cap: ${capFileName}`);
    //console.log(JSON.stringify(capData));
  }
}



parseArgs()
  .then(args => {
    if (args.clear) {
      return exec(`sed -i 's/"id": ".\\+"/"id": "fake.app"/g' .homeycompose/app.json`)
      .then(() => exec(`sed -i 's/"id": ".\\+"/"id": "fake.app"/g' ./app.json`))
      .then(() => exec('find drivers -maxdepth 1 -mindepth 1 ! -name \'*basedriver*\' | xargs rm -rf'))
      .then(() => exec('rm -rf .homeycompose/capabilities/*'))
      .finally(() => Promise.reject(new Error("Cleared driver cache")));
    }
    readDefinition(args.input)
    .then(data => {
      console.log(`Driver ID: ${data.driverId[2]}`);
      const newDriverName = `drivers/${data.driverId[3]}`;
      console.log(`Creating driver: ${newDriverName}`);
      exec(`mkdir -p ${newDriverName}`)
      .then(() => exec(`cp -r basedriver/* ${newDriverName}`))
      .then(() => exec(`sed -i 's/"baseDriver"/"${data.driverId[3]}"/g' ${newDriverName}/driver.compose.json`))
      .then(() => exec(`sed -i 's/DEVICENAME/"${data.driverId[3]}"/g' ${newDriverName}/driver.js`))
      .then(() => exec(`sed -i 's/"capabilities": \\[\\]/"capabilities": \\[\\n    "${data.capabilities.join('",\\n    "')}"\\n  \\]/g' ${newDriverName}/driver.compose.json`))
      .then(() => createCaps(data.capabilitiesObj)
      .then(() => {
        if (args.replace) {
          console.log(`Replaced App ID with: ${data.driverId[2]}`);
          exec(`sed -i 's/"id": ".\\+"/"id": "${data.driverId[2]}"/g' .homeycompose/app.json`);
        }
      }));
    })
  })
  .catch(err => console.log(err.message));

