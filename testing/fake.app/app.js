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
      return args.device.onSetDevicePoint(args.devicePoint.id, args.newValue);
    });
    cardActionSetDevicePointNumeric.registerArgumentAutocompleteListener(
      'capability',
      async (query, args) => {
        return this.generateCapabilityList(query, args, true);
      }
    );
  }

  /**
   * Generates a list of values that are legal for a specific device point
   */
  async generateCapabilityList(query, args) {
    args.device.log(`generate args for capabilities: ${JSON.stringify(Object.keys(args))}`);

    if (args.capability === 'undefined') return [];

    const results = await args.device.oAuth2Client.getDevicePointValues(args.device.instanceId, args.devicePoint.id);

    return results.filter((result) => {
      return result.name.toLowerCase().includes(query.toLowerCase());
    });
  }

}

module.exports = MyApp;
