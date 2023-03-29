Expose this folder as the root-folder of your web server to create a debug interface for the app setup without running on Homey.

Note that the reason it need to be in the root-folder is because all Homey apps need to include the file /homey.js, so if you do
not want to expose this as the root folder then you can instead change the reference of /homey.js in the app settings/index.html
OR you can copy the homey.js file to the root folder of your web server and expose the folder in a different location.
