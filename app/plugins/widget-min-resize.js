// 10-27: react-native-android-widget writes no android:minResizeWidth, so Android falls back to minWidth (110dp), which some launchers
// round to two cells and the Seeker's to one. First (his note on the bamboo 1x1: "can we prevent it") 150dp stopped both widgets at two
// cells; then his ruling the same day ("the 1x1 should have no art and feature the planting gauge instead"; the ensō 1x1 "a version
// without art") made 1x1 a designed size, so 40dp lets every launcher go down to one cell. Native: takes effect with the next build, not a Metro reload.
const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("expo/config-plugins");

const MIN_RESIZE_WIDTH = "40dp";
const MIN_RESIZE_HEIGHT = "40dp";

module.exports = function withWidgetMinResize(config) {
  return withDangerousMod(config, ["android", async (c) => {
    const dir = path.join(c.modRequest.platformProjectRoot, "app/src/main/res/xml");
    for (const name of ["sprouts", "sproutsenso"]) {
      const file = path.join(dir, `widgetprovider_${name}.xml`);
      if (!fs.existsSync(file)) throw new Error(`widget-min-resize: ${file} missing (the widget plugin must run first)`);
      let xml = fs.readFileSync(file, "utf8").replace(/\s*android:minResize(Width|Height)="[^"]*"/g, "");
      xml = xml.replace("<appwidget-provider", "<appwidget-provider").replace(/(android:minHeight="[^"]*")/, `$1\n    android:minResizeWidth="${MIN_RESIZE_WIDTH}"\n    android:minResizeHeight="${MIN_RESIZE_HEIGHT}"`);
      fs.writeFileSync(file, xml);
    }
    return c;
  }]);
};
