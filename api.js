module.exports = {
    async requestDeviceListRefresh({ homey, query }) {

        //const result = await homey.app.getsdfsdf();
        await homey.app.createDeviceList();
        //await new Promise(r => setTimeout(r, 5000));
        return "Done"; //result;
    }

};