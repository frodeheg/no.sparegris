# Restore state
sed -i 's/"no.sparegris2"/"no.sparegris"/g' .homeycompose/app.json
sed -i 's/"Sparegris 2"/"Sparegris"/g' .homeycompose/app.json
sed -i 's/"no.sparegris2"/"no.sparegris"/g' ./app.json
sed -i 's/"Sparegris 2"/"Sparegris"/g' ./app.json

sed -i 's/DEBUG_ACTIVE_BEGIN \*\//DEBUG_BEGIN/g' ./app.js ./settings/index.html
sed -i 's/\/\* DEBUG_ACTIVE_END/DEBUG_END/g' ./app.js ./settings/index.html
