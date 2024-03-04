/* eslint-disable comma-dangle */
'use strict';

const Homey = require('homey');

class MyApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log(`${this.id} has been initialized`);

    // Register action cards
    const cardActionSetDevicePointNumeric = this.homey.flow.getActionCard('set_capability_string');
    cardActionSetDevicePointNumeric.registerRunListener(async (args) => {
      const capDef = args.device.homey.manifest.capabilities[args.capName.id];
      let setValue;
      switch (capDef.type) {
        case 'number':
          setValue = +args.newValue;
          break;
        default:
          console.log('Unknown capability type;');
          console.log(capDef);
          setValue = args.newValue;
          break;
      }
      return args.device.setCapabilityValue(args.capName.id, setValue)
        .then(() => {
          const cardTriggerDevicePointChanged = this.homey.flow.getDeviceTriggerCard('capability_changed');
          const tokens = { value: +setValue, strVal: `${setValue}` };
          const state = { capName: args.capName.id };
          return cardTriggerDevicePointChanged.trigger(this, tokens, state);
        });
    });
    cardActionSetDevicePointNumeric.registerArgumentAutocompleteListener(
      'capName',
      async (query, args) => {
        return this.generateCapabilityList(query, args);
      }
    );

    // Register trigger cards
    const cardTriggerDevicePointChanged = this.homey.flow.getDeviceTriggerCard('capability_changed');
    cardTriggerDevicePointChanged.registerRunListener(async (args, state) => {
      return Promise.resolve(+state.capName === +args.capName.id);
    });
    cardTriggerDevicePointChanged.registerArgumentAutocompleteListener(
      'capName',
      async (query, args) => {
        return this.generateCapabilityList(query, args);
      }
    );
  }

  /**
   * Generates a list of values that are legal for a specific device point
   */
  async generateCapabilityList(query, args) {
    // Reset old parameter as it becomes invalid
    args.newValue = undefined;

    args.device.log(`generate args capability list: ${JSON.stringify(Object.keys(args))}`);

    const results = args.device.driver.manifest.capabilities
      .map((x) => ({ name: x, id: String(x) }));

    return results.filter((result) => {
      return result.name.toLowerCase().includes(query.toLowerCase());
    });
  }

}

module.exports = MyApp;
