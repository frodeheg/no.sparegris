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
  let parseMethod;
  for (let i = 0; i < lines.length; i++) {
    const reducedLine1 = lines[i].slice(lines[i].indexOf(': ') + 2);
    const reducedLine2 = lines[i].slice(lines[i].indexOf('\] ', 6) + 2);
    if (!startFound) {
      if (lines[i].includes('----- ANALYZING DEVICE -----')) startFound = true;
      if (startFound && reducedLine1 === '----- ANALYZING DEVICE -----') parseMethod = 1;
      else if (startFound && reducedLine2 === '----- ANALYZING DEVICE -----') parseMethod = 2;
      else throw new Error('Unknown parse method');
      continue;
    }
    const line = (parseMethod === 1 ? reducedLine1 : reducedLine2);
    if (line.includes('--- ANALYZING DEVICE DONE ---')) break;
    let parsed = line.slice(line.indexOf(':') + 1);
    parsed = parsed.replace(/^\s+/, '');
    let capName = line.slice(line.indexOf('\'') + 1);
    capName = capName.slice(0, capName.indexOf('\''));
    if (line.includes('Device ID:')) definition.id = parsed;
    else if (line.includes('Device name:')) definition.name = parsed;
    else if (line.includes('Device Name:')) definition.name = parsed;
    else if (line.includes('Driver Uri:')) driverUri = parsed;
    else if (line.includes('Driver Id:')) driverId = parsed;
    else if (line.includes('Options for')) definition.capabilitiesObj[capName] = JSON.parse(parsed);
    else if (line.includes('Capabilities:')) definition.capabilities = parsed.split(',');
    else console.log(`Unknown line: ${line}`);
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
    let { type, title, units, insights, getable, setable, values, insightsTitleTrue, insightsTitleFalse, titleTrue, titleFalse, decimals,
          min, max, step, chartType, options, desc } = capabilitiesObj[fullCapName];
    if (units === null) units = undefined;
    if (insightsTitleTrue === null) insightsTitleTrue = undefined;
    if (insightsTitleFalse === null) insightsTitleFalse = undefined;
    if (desc === null) desc = undefined;
    const uiComponent = !setable ? 'sensor'
      : type === 'boolean' ? 'toggle'
      : type === 'string' ? null
      : type === 'enum' ? 'picker'
      : type === 'number' ? 'slider' //thermostat color battery
      : null;
    const capData = {
      type, title, units, insights, getable, setable, uiComponent, values, insightsTitleTrue, insightsTitleFalse, titleTrue, titleFalse, decimals,
      min, max, step, chartType, options, desc
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
      .then(() => exec(`sed -i 's/"en": "Fake .\\+"/"en": "Fake App"/g' .homeycompose/app.json`))
      .then(() => exec(`git checkout ./app.json .homeycompose/flow/actions/set_capability_string.json`))
      .then(() => exec(`git checkout ./app.json .homeycompose/flow/triggers/capability_changed.json`))
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
      .then(() => exec(`sed -i 's/"baseDriver"/"Fake ${data.driverId[3]}"/g' ${newDriverName}/driver.compose.json`))
      .then(() => exec(`sed -i 's/"capabilities": \\[\\]/"capabilities": \\[\\n    "${data.capabilities.join('",\\n    "')}"\\n  \\]/g' ${newDriverName}/driver.compose.json`))
      .then(() => exec(`sed -i 's/"filter": "driver_id=.\\+"/"filter": "driver_id=${data.driverId[3]}"/g' .homeycompose/flow/actions/set_capability_string.json`))
      .then(() => exec(`sed -i 's/"filter": "driver_id=.\\+"/"filter": "driver_id=${data.driverId[3]}"/g' .homeycompose/flow/triggers/capability_changed.json`))
      .then(() => createCaps(data.capabilitiesObj)
      .then(() => {
        if (args.replace) {
          console.log(`Replaced App ID with: ${data.driverId[2]}`);
          exec(`sed -i 's/"id": ".\\+"/"id": "${data.driverId[2]}"/g' .homeycompose/app.json`)
          .then(() => exec(`sed -i 's/"en": "Fake .\\+"/"en": "Fake ${data.driverId[2]}"/g' .homeycompose/app.json`));
        }
      }));
    })
  })
  .catch(err => console.log(err.message));

