# Piggy Bank
https://homey.app/no-no/app/no.sparegris/PiggyBank/

Save money by controling when to use electricity

New features I want input from others before I do anything:
* Should I add a new controller option that leaves devices in the state they are with the only option to turn them off in the event the app does not have any other devices to turn off to get below the power limit? (or is it sufficient that this can be done outside of the app with a flow right now?)
* Should I add an action when the power tariff is once again within reach after a manual powerdown has been signaled?

TODO list:
* Use the devices default setpoint temperatures when creating the device list for the first time. Water heaters get way too low temp as default.
* Add number of cheap/expensive/normal hours to the device capability list
* Add calculation of what is best, higher tariff or money saved by moving electricity between price points
* Old capabilities doesn't seem to be deleted from the statistics section when they are deleted, need to manually delete the legacy capabilities from the statistics section as well.
* Remove public API for refreshing devices. Use settings instead.
* Find out if the public-variable for API's can be used to expose an api to the høiax app.
