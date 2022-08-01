# Make backup
cp .homeycompose/app.json .homeycompose/app.json.bak
sed -i 's/"no.sparegris"/"no.sparegris2"/g' .homeycompose/app.json

# Run on homey
homey app run


# Restore backup
cp .homeycompose/app.json.bak .homeycompose/app.json
