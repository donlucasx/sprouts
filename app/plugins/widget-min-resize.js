// 10-27 (his note: the bamboo resized to 1x1 "doesnt look good- can we prevent it"): react-native-android-widget writes no
// android:minResizeWidth, so Android falls back to minWidth (110dp), which the Seeker's launcher fits in ONE cell (its 4x1 is 372 dp,
// about 93 dp a cell plus spacing). 150dp is more than one cell and less than two: both widgets stop at two cells wide, one row tall
// still allowed (the slim pill). Native: takes effect with the next build, not a Metro reload.
const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("expo/config-plugins");

const MIN_RESIZE_WIDTH = "150dp";
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
