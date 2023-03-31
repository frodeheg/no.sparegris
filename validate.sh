# Validate from Homey perspective
# homey app validate

# Modify app.js so Homey refers to test setup
cp ./app.js ./app.js.bak
sed -i 's+const Homey = require('\''homey'\'');+const Homey = require('\''./testing/homey'\'');+g' ./app.js
sed -i 's+const { Log } = require('\''homey-log'\'');+const { Log } = require('\''./testing/homey-log'\'');+g' ./app.js
sed -i 's+const { HomeyAPI } = require('\''homey-api'\'');+const { HomeyAPI } = require('\''./testing/homey-api'\'');+g' ./app.js

# Run test
node testing/test.js

# Undo the testing changes
sed -i 's+const Homey = require('\''./testing/homey'\'');+const Homey = require('\''homey'\'');+g' ./app.js
sed -i 's+const { Log } = require('\''./testing/homey-log'\'');+const { Log } = require('\''homey-log'\'');+g' ./app.js
sed -i 's+const { HomeyAPI } = require('\''./testing/homey-api'\'');+const { HomeyAPI } = require('\''homey-api'\'');+g' ./app.js
