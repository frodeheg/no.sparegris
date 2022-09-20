# Make backup
cp .homeycompose/app.json .homeycompose/app.json.bak
sed -i 's/"no.sparegris"/"no.sparegris2"/g' .homeycompose/app.json
sed -i 's/"Sparegris"/"Sparegris 2"/g' .homeycompose/app.json
cp ./app.json ./app.js.bak
sed -i 's/DEBUG_BEGIN/DEBUG_ACTIVE_BEGIN *\//g' ./app.js ./settings/index.html
sed -i 's/DEBUG_END/\/* DEBUG_ACTIVE_END/g' ./app.js ./settings/index.html
