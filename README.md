# Piggy Bank
https://homey.app/no-no/app/no.sparegris/PiggyBank/

Save money by controling when to use electricity

New features I want input from others before I do anything:
* Do you want to keep Zone control as it is or do you want it to affect heaters only (right now it turns off lights as well, which might be a bit odd if you use zone-control to turn off heaters when airing).
* Do you want an output signal for the current price point if internal price points are used.
* Do you want a condition that prevents signalling that we are out of power before at least x% of the power tariff has been used? (where x is set in the settings)

TODO list:
* Make some outputs from "innsikt" deprecated so only the app flows are visible.
* Add zone-control for mode changes.
* Improve handling of AC devices (not sure how yet - might need more discussions requested by @dooniem)
* Add number of cheap/expensive/normal hours to the device capability list
* Add calculation of what is best, higher tariff or money saved by moving electricity between price points
* Allow the insights data to be tracked even when the app is disabled.

=== ISSUES I DO NOT KNOW ANY WAY TO RESOLVE ===
* Old capabilities are not deleted from the statistics section (insights) when they are deleted, and the homey web api does not give the app permission to delete it. Thus the only way to delete deprecated statistics is to manually do this with the web api playground or by deleting the device and reinstalling it. I do not know why Athom is this restrictive but I am sorry I cannot clean up the mess.

=== REJECTED FEATURES ===
(if you're not happy with this, please make contact and I might reconsider)
* A new output signal when the power tariff is once again within reach after a manual powerdown has been signaled.
  => Reason: Currently this can also be seen by comparing how much power Sparegris reports as available for other devices with > 0
