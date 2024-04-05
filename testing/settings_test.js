+/*
+    console.log('-------------DEBUG START---------------------');
+
+    const startTime = new Date();
+    for (let i = 0; i < 100; i++) {
+      this.__accum_energy = [
+        Math.random() * 1000,
+        Math.random() * 1000,
+        Math.random() * 1000,
+        Math.random() * 1000,
+      ];
+      this.__accum_energyTime = new Date(Math.floor(Math.random() * 1000000000000));
+      this.__oldMeterValue = Math.random() * 1000;
+      this.__oldMeterValueValid = true;
+      this.__oldMeterTime = new Date(Math.floor(Math.random() * 1000000000000));
+      this.__pendingEnergy = [
+        Math.random() * 1000,
+        Math.random() * 1000,
+        Math.random() * 1000,
+        Math.random() * 1000,
+      ];
+      this.__current_power = Math.random() * 1000;
+      this.__current_power_time = new Date(Math.floor(Math.random() * 1000000000000));
+      this.__energy_last_slot = Math.random() * 1000;
+      this.__offeredEnergy = Math.random() * 1000;
+      this.__missing_power_this_slot = Math.floor(Math.random() * 50);
+      this.__fakeEnergy = [
+        Math.random() * 1000,
+        Math.random() * 1000,
+        Math.random() * 1000,
+        Math.random() * 1000,
+      ];
+      this.__pendingOnNewSlot = [];
+*/
+      // Option 1:
+      /*this.homey.settings.set('safeShutdown__accum_energy', this.__accum_energy);
+      this.homey.settings.set('safeShutdown__accum_energyTime', this.__accum_energyTime);
+      this.homey.settings.set('safeShutdown__oldMeterValue', this.__oldMeterValue);
+      this.homey.settings.set('safeShutdown__oldMeterValueValid', this.__oldMeterValueValid);
+      this.homey.settings.set('safeShutdown__oldMeterTime', this.__oldMeterTime);
+      this.homey.settings.set('safeShutdown__pendingEnergy', this.__pendingEnergy);
+      this.homey.settings.set('safeShutdown__current_power', this.__current_power);
+      this.homey.settings.set('safeShutdown__current_power_time', this.__current_power_time);
+      this.homey.settings.set('safeShutdown__energy_last_slot', this.__energy_last_slot);
+      this.homey.settings.set('safeShutdown__offeredEnergy', this.__offeredEnergy);
+      this.homey.settings.set('safeShutdown__missing_power_this_slot', this.__missing_power_this_slot);
+      this.homey.settings.set('safeShutdown__fakeEnergy', this.__fakeEnergy);
+      this.homey.settings.set('safeShutdown__pendingOnNewSlot', this.__pendingOnNewSlot);*/
+/*
+      // Option 2:
+      const structure = {
+        accum_energy: this.__accum_energy,
+        accum_energyTime: this.__accum_energyTime,
+        oldMeterValue: this.__oldMeterValue,
+        oldMeterValueValid: this.__oldMeterValueValid,
+        oldMeterTime: this.__oldMeterTime,
+        pendingEnergy: this.__pendingEnergy,
+        current_power: this.__current_power,
+        current_power_time: this.__current_power_time,
+        energy_last_slot: this.__energy_last_slot,
+        offeredEnergy: this.__offeredEnergy,
+        missing_power_this_slot: this.__missing_power_this_slot,
+        fakeEnergy: this.__fakeEnergy,
+        pendingOnNewSlot: this.__pendingOnNewSlot,
+      };
+      this.homey.settings.set('safeShutdown', structure);
+    }
+    const endTime = new Date();
+    console.log(`TIME DIFF: ${endTime - startTime}`);
+    // Randomizers only: 4
+    // Settings set: 4629
+
+    console.log('-------------DEBUG END---------------------'); */
